import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import type { VisitorSessionClaims } from "@realwise/auth";
import { PrismaService } from "../../prisma/prisma.service";
import { AccessLogService } from "../access/access-log.service";
import type { MemberContext } from "../access/member-context";
import { OrdersService } from "../orders/orders.service";
import { PharmacyNotificationsService } from "../pharmacy-notifications/pharmacy-notifications.service";
import { resolveUploadOwner } from "./upload-owner";
import { PharmacySettingsService } from "../pharmacy-settings/pharmacy-settings.service";
import { nextRxNumber } from "../pharmacy-common/counters";
import { parseLimit, sliceCursor } from "../pharmacy-common/format";
import { RX_STATUS_BADGE, RX_STATUS_LABEL } from "../pharmacy-common/labels";
import { deleteFile, getFile, putFile, sniffFileType } from "../pharmacy-common/storage";
import { OPEN_RETENTION_CAP_DAYS, computeRetentionDeleteAt, evaluateRxAccess, isPurgeDue, retentionLabel } from "./retention";

export const RX_MAX_BYTES = 8 * 1024 * 1024;
export const RX_CONSENT_VERSION = "2026-10";
export const PURGED_SUMMARY = "Dados apagados por retenção";
const logger = new Logger("PrescriptionsService");

function bad(code: string, message: string) {
  return new BadRequestException({ statusCode: 400, error: "Bad Request", code, message });
}

type RxWithOrder = {
  id: string;
  businessId: string;
  number: number;
  patientName: string | null;
  status: "pending" | "approved" | "rejected";
  mimeType: string;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewedByName: string | null;
  rejectReason: string | null;
  retentionDeleteAt: Date | null;
  fileDeletedAt: Date | null;
  orderId: string | null;
  order: { code: string; items: Array<{ nameSnapshot: string; saleClassSnapshot: string }> } | null;
};

export function rxListDto(rx: RxWithOrder) {
  const rxItem = rx.order?.items.find((i) => i.saleClassSnapshot === "prescription") ?? rx.order?.items[0];
  return {
    id: rx.id,
    code: `RX-${rx.number}`,
    patientName: rx.patientName,
    med: rxItem?.nameSnapshot ?? "Aguardando pedido",
    orderId: rx.orderId,
    orderCode: rx.order?.code ?? null,
    createdAt: rx.createdAt.toISOString(),
    status: rx.status,
    statusLabel: RX_STATUS_LABEL[rx.status],
    badge: RX_STATUS_BADGE[rx.status],
  };
}

export function rxDetailDto(rx: RxWithOrder) {
  return {
    ...rxListDto(rx),
    mimeType: rx.mimeType,
    fileUrl: `/api/prescriptions/${rx.id}/file`,
    fileAvailable: !rx.fileDeletedAt,
    reviewedAt: rx.reviewedAt ? rx.reviewedAt.toISOString() : null,
    reviewedByName: rx.reviewedByName,
    rejectReason: rx.rejectReason,
    retentionDeleteAt: rx.retentionDeleteAt ? rx.retentionDeleteAt.toISOString() : null,
    retentionLabel: retentionLabel(rx),
  };
}

const INCLUDE = { order: { select: { code: true, items: { select: { nameSnapshot: true, saleClassSnapshot: true } } } } } as const;

@Injectable()
export class PrescriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessLog: AccessLogService,
    private readonly notifications: PharmacyNotificationsService,
    private readonly orders: OrdersService,
    private readonly settings: PharmacySettingsService,
  ) {}

  // ------------------------------------------------------------------ visitor upload (also callable by the chat engine)

  async upload(input: {
    businessId: string;
    conversationId: string;
    visitor: Partial<VisitorSessionClaims> & { visitorToken?: string };
    file: { buffer: Buffer } | undefined;
    consent: unknown;
    patientName?: string;
    ip?: string;
    userAgent?: string;
  }) {
    const { businessId, visitor } = input;
    if (!visitor || (visitor.businessId && visitor.businessId !== businessId) || (!visitor.leadId && !visitor.visitorToken)) {
      throw new ForbiddenException({ statusCode: 403, error: "Forbidden", code: "VISITOR_NOT_IDENTIFIED", message: "Abra a conversa novamente para enviar a receita." });
    }
    if (!(input.consent === true || input.consent === "true")) {
      throw bad("CONSENT_REQUIRED", "É preciso concordar com o uso da receita para enviá-la.");
    }
    if (!input.file?.buffer?.length) throw bad("FILE_REQUIRED", "Envie a foto ou o PDF da receita.");
    if (input.file.buffer.length > RX_MAX_BYTES) throw bad("FILE_TOO_LARGE", "O arquivo deve ter até 8 MB.");
    const type = sniffFileType(input.file.buffer);
    if (!type) throw bad("INVALID_FILE", "Envie uma imagem (JPEG, PNG, WebP) ou um PDF.");

    const conversation = await this.prisma.client.conversation.findFirst({ where: { id: input.conversationId, businessId }, select: { id: true, leadId: true, visitorToken: true } });
    const owner = resolveUploadOwner(businessId, visitor, conversation);
    if (!owner.ok || !conversation) throw new NotFoundException("Conversa não encontrada.");
    // The visitor may still be anonymous (the photo comes before the phone number in the Rx lane).
    const lead = owner.leadId ? await this.prisma.client.lead.findFirst({ where: { id: owner.leadId, businessId }, select: { id: true, phoneNormalized: true } }) : null;

    const consent = await this.prisma.client.consentRecord.create({
      data: {
        businessId,
        leadId: lead?.id ?? null,
        phoneHash: createHash("sha256").update(lead ? lead.phoneNormalized : `conversation:${conversation.id}`).digest("hex"),
        consentTextVersion: RX_CONSENT_VERSION,
        purposes: ["prescription_upload"],
        ipAddress: input.ip,
        userAgent: input.userAgent,
      },
    });

    // Private tree: never under a statically served path (the API serves no static files at all).
    const key = `private/prescriptions/${businessId}/${randomUUID()}.${type.ext}`;
    await putFile(key, input.file.buffer);
    let rx;
    try {
      rx = await this.prisma.client.$transaction(async (tx) => {
        const number = await nextRxNumber(tx as any, businessId);
        return tx.prescriptionUpload.create({
          data: {
            businessId,
            conversationId: conversation.id,
            leadId: lead?.id ?? null,
            number,
            storageKey: key,
            mimeType: type.mime,
            sizeBytes: input.file!.buffer.length,
            patientName: input.patientName?.trim().slice(0, 120) || null,
            consentId: consent.id,
            retentionDeleteAt: new Date(Date.now() + OPEN_RETENTION_CAP_DAYS * 24 * 3600 * 1000),
          },
        });
      });
    } catch (e) {
      await deleteFile(key);
      throw e;
    }
    void this.notifications.rxUploaded({ businessId, code: `RX-${rx.number}` }).catch(() => {});
    return { prescription: { id: rx.id, code: `RX-${rx.number}`, status: rx.status } };
  }

  // ------------------------------------------------------------------ staff

  async list(m: MemberContext, q: { status?: string; q?: string; limit?: string; cursor?: string }) {
    const limit = parseLimit(q.limit);
    const search = q.q?.trim();
    const base = {
      businessId: m.businessId,
      ...(search ? { OR: [{ patientName: { contains: search, mode: "insensitive" as const } }, { order: { code: { contains: search, mode: "insensitive" as const } } }, ...(Number(search.replace(/\D/g, "")) ? [{ number: Number(search.replace(/\D/g, "")) }] : [])] } : {}),
    };
    const status = q.status === "pending" || q.status === "approved" || q.status === "rejected" ? q.status : undefined;
    const [rows, grouped] = await Promise.all([
      this.prisma.client.prescriptionUpload.findMany({
        where: { ...base, ...(status ? { status } : {}) },
        include: INCLUDE,
        orderBy: status === "pending" ? [{ createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
      this.prisma.client.prescriptionUpload.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    ]);
    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const g of grouped) counts[g.status] = g._count._all;
    const { items, nextCursor } = sliceCursor(rows, limit);
    return { items: items.map((r) => rxListDto(r as unknown as RxWithOrder)), counts, nextCursor };
  }

  private async load(businessId: string, id: string) {
    const rx = await this.prisma.client.prescriptionUpload.findFirst({ where: { id, businessId }, include: INCLUDE });
    if (!rx) throw new NotFoundException("Receita não encontrada.");
    return rx;
  }

  async get(m: MemberContext, id: string) {
    return rxDetailDto((await this.load(m.businessId, id)) as unknown as RxWithOrder);
  }

  /** Access-checked bytes. Other business => 404, purged => 410, logged as prescription.download. */
  async file(m: MemberContext, id: string): Promise<{ data: Buffer; mime: string }> {
    const rx = await this.prisma.client.prescriptionUpload.findUnique({ where: { id }, include: { order: { select: { code: true } } } });
    const verdict = evaluateRxAccess({ businessId: m.businessId, permissions: m.permissions }, rx);
    if (verdict === "not_found") throw new NotFoundException("Receita não encontrada.");
    if (verdict === "denied") throw new ForbiddenException({ statusCode: 403, error: "Forbidden", code: "PERMISSION_DENIED", message: 'Você não tem acesso a "Receitas" (visualização).', section: "receitas", required: "view" });
    if (verdict === "purged" || !rx) throw new GoneException({ statusCode: 410, error: "Gone", code: "PRESCRIPTION_PURGED", message: "O arquivo desta receita já foi apagado conforme a política de retenção." });
    let data: Buffer;
    try {
      data = await getFile(rx.storageKey);
    } catch {
      throw new GoneException({ statusCode: 410, error: "Gone", code: "PRESCRIPTION_PURGED", message: "O arquivo desta receita não está mais disponível." });
    }
    await this.accessLog.record({
      businessId: m.businessId,
      actor: m,
      action: "prescription.download",
      target: `RX-${rx.number}`,
      summary: `Abriu a receita RX-${rx.number}${rx.order ? ` do pedido ${rx.order.code}` : ""}`,
    });
    return { data, mime: rx.mimeType };
  }

  async approve(m: MemberContext, id: string) {
    const rx = await this.load(m.businessId, id);
    if (rx.status !== "pending") throw new ConflictException({ statusCode: 409, error: "Conflict", code: "INVALID_STATE", message: "Esta receita já foi analisada." });
    const now = new Date();
    const res = await this.prisma.client.prescriptionUpload.updateMany({ where: { id, businessId: m.businessId, status: "pending" }, data: { status: "approved", reviewedAt: now, reviewedByMemberId: m.memberId, reviewedByName: m.name } });
    if (res.count === 0) throw new ConflictException({ statusCode: 409, error: "Conflict", code: "INVALID_STATE", message: "Esta receita já foi analisada." });
    await this.accessLog.record({
      businessId: m.businessId,
      actor: m,
      action: "prescription.approve",
      target: `RX-${rx.number}`,
      summary: `Aprovou RX-${rx.number}${rx.order ? ` do pedido ${rx.order.code}` : ""}`,
    });
    return this.get(m, id);
  }

  async reject(m: MemberContext, id: string, reasonRaw: unknown) {
    const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
    if (reason.length < 3 || reason.length > 300) throw bad("REASON_REQUIRED", "Informe o motivo da recusa (3 a 300 caracteres).");
    const rx = await this.load(m.businessId, id);
    if (rx.status !== "pending") throw new ConflictException({ statusCode: 409, error: "Conflict", code: "INVALID_STATE", message: "Esta receita já foi analisada." });
    const now = new Date();
    const res = await this.prisma.client.prescriptionUpload.updateMany({ where: { id, businessId: m.businessId, status: "pending" }, data: { status: "rejected", reviewedAt: now, reviewedByMemberId: m.memberId, reviewedByName: m.name, rejectReason: reason } });
    if (res.count === 0) throw new ConflictException({ statusCode: 409, error: "Conflict", code: "INVALID_STATE", message: "Esta receita já foi analisada." });
    let cascaded = false;
    if (rx.orderId) cascaded = await this.orders.rejectForPrescription(m.businessId, rx.orderId, reason, { memberId: m.memberId, name: m.name });
    await this.tellCustomer(m.businessId, rx.conversationId, `Sua receita RX-${rx.number} foi recusada pela farmácia. Motivo: ${reason}.${cascaded ? ` O pedido ${rx.order?.code} foi encerrado.` : ""} Se quiser, envie uma nova receita ou fale com o farmacêutico.`);
    await this.accessLog.record({
      businessId: m.businessId,
      actor: m,
      action: "prescription.reject",
      target: `RX-${rx.number}`,
      summary: `Recusou RX-${rx.number}${rx.order ? ` do pedido ${rx.order.code}` : ""}`,
    });
    return this.get(m, id);
  }

  /** System message in the customer's conversation (the status page shows the same reason). */
  private async tellCustomer(businessId: string, conversationId: string | null, content: string) {
    if (!conversationId) return;
    try {
      const conv = await this.prisma.client.conversation.findFirst({ where: { id: conversationId, businessId }, select: { id: true } });
      if (!conv) return;
      await this.prisma.client.message.create({ data: { businessId, conversationId, role: "system", content } });
      await this.prisma.client.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), messageCount: { increment: 1 } } });
    } catch (e) {
      logger.warn(`could not post rejection message: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ------------------------------------------------------------------ job: pharmacy:retention-purge

  /**
   * Daily. Deletes prescription files past retentionDeleteAt (row stays: code, status, reviewer), and
   * blanks expired handoff briefs. Logs COUNTS only.
   */
  async runRetentionPurge(now = Date.now()): Promise<{ filesDeleted: number; fileErrors: number; briefsCleared: number }> {
    const due = await this.prisma.client.prescriptionUpload.findMany({
      where: { fileDeletedAt: null, retentionDeleteAt: { lte: new Date(now) } },
      select: { id: true, storageKey: true, retentionDeleteAt: true, fileDeletedAt: true },
      take: 5000,
    });
    let filesDeleted = 0;
    let fileErrors = 0;
    for (const rx of due) {
      if (!isPurgeDue(rx, now)) continue;
      if (await deleteFile(rx.storageKey)) {
        await this.prisma.client.prescriptionUpload.update({ where: { id: rx.id }, data: { fileDeletedAt: new Date(now) } });
        filesDeleted++;
      } else fileErrors++;
    }
    const cleared = await this.prisma.client.pharmacistHandoff.updateMany({
      where: { retentionDeleteAt: { lte: new Date(now) }, NOT: { summary: PURGED_SUMMARY } },
      data: { brief: {}, summary: PURGED_SUMMARY, answerText: null },
    });
    logger.log(`retention purge: ${filesDeleted} files deleted, ${fileErrors} errors, ${cleared.count} handoff briefs cleared`);
    return { filesDeleted, fileErrors, briefsCleared: cleared.count };
  }

  /** Re-exported so settings changes could recompute (kept for the worker/unit tests). */
  retentionFor(uploadedAt: Date, closedAt: Date | null, reviewedAt: Date | null, days: number) {
    return computeRetentionDeleteAt({ uploadedAt, closedAt, reviewedAt, retentionDays: days });
  }
}
