import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AccessLogService } from "../access/access-log.service";
import type { MemberContext } from "../access/member-context";
import { PushService } from "../push/push.service";
import { ChatHumanService } from "../chat/chat-human.service";
import { parseLimit, sliceCursor } from "../pharmacy-common/format";
import { buildSuggestion, handoffDetailDto, handoffListDto, type HandoffRow } from "./handoff-dto";
import { buildWhatsappLinks, buildWhatsappMessage, firstNameOf, MAX_WHATSAPP_MESSAGE_CHARS, whatsappDigits } from "./whatsapp-message";

const logger = new Logger("HandoffsService");
const VISITOR_LIVE_WINDOW_MS = 45_000;

function conflict(code: string, message: string) {
  return new ConflictException({ statusCode: 409, error: "Conflict", code, message });
}

@Injectable()
export class HandoffsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessLog: AccessLogService,
    private readonly push: PushService,
    private readonly human: ChatHumanService,
  ) {}

  /**
   * "answered" goes back to "open" when the customer wrote again after the answer (API.md 2.3).
   * Done lazily on reads so it never depends on the chat engine remembering to do it.
   */
  async reopenAnswered(businessId: string): Promise<void> {
    try {
      await this.prisma.client.$executeRaw`UPDATE "PharmacistHandoff" h SET "status" = 'open' WHERE h."businessId" = ${businessId} AND h."status" = 'answered' AND h."answeredAt" IS NOT NULL AND EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = h."conversationId" AND m."role" = 'visitor' AND m."createdAt" > h."answeredAt")`;
    } catch (e) {
      logger.warn(`reopenAnswered failed: ${e instanceof Error ? e.message : e}`);
    }
  }


  private async withLeads<T extends { leadId: string | null }>(businessId: string, rows: T[]): Promise<Array<T & { lead: { name: string | null; phone?: string | null } | null }>> {
    const ids = [...new Set(rows.map((r) => r.leadId).filter((x): x is string => !!x))];
    const leads = ids.length ? await this.prisma.client.lead.findMany({ where: { businessId, id: { in: ids } }, select: { id: true, name: true } }) : [];
    const byId = new Map(leads.map((l) => [l.id, l]));
    return rows.map((r) => ({ ...r, lead: r.leadId ? byId.get(r.leadId) ?? null : null }));
  }

  async list(businessId: string, q: { status?: string; limit?: string; cursor?: string }) {
    await this.reopenAnswered(businessId);
    const limit = parseLimit(q.limit);
    const status = q.status === "answered" || q.status === "closed" || q.status === "open" ? q.status : "open";
    const [rows, open, answered, urgent] = await Promise.all([
      this.prisma.client.pharmacistHandoff.findMany({
        where: { businessId, status },
        orderBy: [{ urgent: "desc" }, { createdAt: "asc" }, { id: "asc" }],
        take: limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
      this.prisma.client.pharmacistHandoff.count({ where: { businessId, status: "open" } }),
      this.prisma.client.pharmacistHandoff.count({ where: { businessId, status: "answered" } }),
      this.prisma.client.pharmacistHandoff.count({ where: { businessId, status: "open", urgent: true } }),
    ]);
    const { items, nextCursor } = sliceCursor(rows, limit);
    const withLeads = await this.withLeads(businessId, items);
    return { items: withLeads.map((h) => handoffListDto(h as unknown as HandoffRow)), counts: { open, answered, urgent }, nextCursor };
  }

  private async load(businessId: string, id: string) {
    const h = await this.prisma.client.pharmacistHandoff.findFirst({ where: { id, businessId } });
    if (!h) throw new NotFoundException("Atendimento não encontrado.");
    const [withLead] = await this.withLeads(businessId, [h]);
    return withLead;
  }

  private async detail(businessId: string, id: string) {
    const h = await this.load(businessId, id);
    const brief = (h.brief ?? {}) as Record<string, unknown>;
    const ids = Array.isArray(brief.suggestedProducts) ? (brief.suggestedProducts as Array<{ productId?: string }>).map((p) => p?.productId).filter((x): x is string => typeof x === "string") : [];
    const products = ids.length ? await this.prisma.client.product.findMany({ where: { businessId, id: { in: ids }, active: true, deletedAt: null }, select: { id: true, name: true, presentation: true, priceCents: true, stockQty: true } }) : [];
    const live = new Map(products.map((p) => [p.id, { name: [p.name, p.presentation].filter(Boolean).join(" "), priceCents: p.priceCents, stockQty: p.stockQty }]));
    return handoffDetailDto(h as unknown as HandoffRow, buildSuggestion(brief, live));
  }

  async get(businessId: string, id: string) {
    await this.reopenAnswered(businessId);
    return this.detail(businessId, id);
  }

  /**
   * The pharmacist answers inside the customer's conversation (through ChatHumanService, which writes the
   * "Nome · Função entrou na conversa" banner and the author-stamped message).
   */
  async reply(m: MemberContext, id: string, textRaw: unknown) {
    const text = typeof textRaw === "string" ? textRaw.trim() : "";
    if (text.length < 1 || text.length > 2000) throw new BadRequestException({ statusCode: 400, error: "Bad Request", code: "INVALID_TEXT", message: "A resposta deve ter de 1 a 2000 caracteres." });
    await this.reopenAnswered(m.businessId);
    const h = await this.load(m.businessId, id);
    if (h.status === "closed") throw conflict("INVALID_STATE", "Este atendimento já foi encerrado.");
    const conversation = await this.prisma.client.conversation.findFirst({
      where: { id: h.conversationId, businessId: m.businessId },
      select: { id: true, resumeToken: true, lastVisitorSeenAt: true, business: { select: { slug: true, name: true } } },
    });
    if (!conversation) throw conflict("CONVERSATION_GONE", "A conversa deste atendimento não existe mais.");

    // The chat module owns how a person appears in a conversation: join banner once per person, then the
    // owner message carrying name + role. No brief text is ever written to any Message.
    const now = new Date();
    await this.human.recordHumanReply({ businessId: m.businessId, conversationId: conversation.id, author: { memberId: m.memberId, name: m.name, roleName: m.roleName }, text });
    const { inProgress: _clear, ...briefWithoutMarker } = (h.brief && typeof h.brief === "object" ? h.brief : {}) as Record<string, unknown>;
    await this.prisma.client.pharmacistHandoff.update({
      where: { id },
      data: { status: "answered", answerText: text, answeredAt: now, answeredByMemberId: m.memberId, answeredByName: m.name, answeredByRole: m.roleName, ...(_clear ? { brief: briefWithoutMarker as object } : {}) },
    });

    // Push only when the visitor is not looking at the chat. The body is deliberately generic: a lock screen must not show health text.
    const live = !!conversation.lastVisitorSeenAt && Date.now() - conversation.lastVisitorSeenAt.getTime() < VISITOR_LIVE_WINDOW_MS;
    if (!live) {
      const chatUrl = (process.env.NEXT_PUBLIC_CHAT_URL ?? "http://localhost:3005").replace(/\/+$/, "");
      const url = `${chatUrl}/${conversation.business.slug}?c=${conversation.id}${conversation.resumeToken ? `&t=${conversation.resumeToken}` : ""}`;
      this.push.sendToConversation(conversation.id, { title: conversation.business.name, body: "O farmacêutico respondeu ao seu atendimento.", url, tag: `handoff-${id}` }).catch(() => {});
    }
    await this.accessLog.record({ businessId: m.businessId, actor: m, action: "handoff.answer", summary: "Respondeu atendimento", detail: { handoffId: id } });
    return this.detail(m.businessId, id);
  }

  async close(m: MemberContext, id: string) {
    const h = await this.load(m.businessId, id);
    if (h.status === "closed") return this.detail(m.businessId, id);
    await this.prisma.client.pharmacistHandoff.update({ where: { id }, data: { status: "closed", closedAt: new Date() } });
    await this.accessLog.record({ businessId: m.businessId, actor: m, action: "handoff.close", summary: "Encerrou atendimento", detail: { handoffId: id } });
    return this.detail(m.businessId, id);
  }

  // -------------------------------------------------------------------------------------------
  // WhatsApp hand-over ("Iniciar atendimento"): the conversation continues on WhatsApp Web.
  // The full phone number is returned ONLY here (atendimento:edit + CRF) and every call is access-logged.
  // -------------------------------------------------------------------------------------------

  /** Default message + links for the preview dialog. Logs that the number was revealed (no health data in the log). */
  async whatsappDraft(m: MemberContext, id: string) {
    const h = await this.load(m.businessId, id);
    if (h.status === "closed") throw conflict("INVALID_STATE", "Este atendimento já foi encerrado.");
    const phone = await this.customerPhone(m.businessId, h.leadId);
    if (!phone) {
      throw conflict("NO_PHONE", "Este cliente não informou o WhatsApp. Responda pelo chat.");
    }
    const business = await this.prisma.client.business.findFirst({ where: { id: m.businessId }, select: { name: true } });
    const message = buildWhatsappMessage({
      customerName: h.lead?.name ?? null,
      attendantName: m.name,
      attendantRole: m.roleName,
      pharmacyName: business?.name ?? "",
      reason: h.reason,
      brief: (h.brief ?? {}) as Record<string, unknown>,
    });
    const links = buildWhatsappLinks(phone, message)!;
    await this.accessLog.record({ businessId: m.businessId, actor: m, action: "handoff.whatsapp_link", summary: "Abriu o contato por WhatsApp de um atendimento", detail: { handoffId: id } });
    return {
      customerFirstName: firstNameOf(h.lead?.name) || null,
      phone: links.phoneDigits,
      message,
      maxChars: MAX_WHATSAPP_MESSAGE_CHARS,
      webUrl: links.webUrl,
      appUrl: links.appUrl,
    };
  }

  private async customerPhone(businessId: string, leadId: string | null): Promise<string | null> {
    if (!leadId) return null;
    const lead = await this.prisma.client.lead.findFirst({ where: { id: leadId, businessId }, select: { phone: true, phoneNormalized: true } });
    const phone = lead?.phoneNormalized || lead?.phone || null;
    return whatsappDigits(phone) ? phone : null;
  }

  /**
   * Marks the handoff "em atendimento" (brief.inProgress; the status machine stays open/answered/closed) and records who
   * started it. `channel`: "whatsapp" (opened WhatsApp Web) or "chat" (answering in the web chat).
   */
  async start(m: MemberContext, id: string, channelRaw?: unknown) {
    const channel = channelRaw === "chat" ? "chat" : "whatsapp";
    await this.reopenAnswered(m.businessId);
    const h = await this.load(m.businessId, id);
    if (h.status === "closed") throw conflict("INVALID_STATE", "Este atendimento já foi encerrado.");
    const brief = (h.brief && typeof h.brief === "object" ? h.brief : {}) as Record<string, unknown>;
    const inProgress = { at: new Date().toISOString(), byMemberId: m.memberId, byName: m.name, byRole: m.roleName, channel };
    await this.prisma.client.pharmacistHandoff.update({ where: { id }, data: { brief: { ...brief, inProgress } as object } });
    await this.accessLog.record({
      businessId: m.businessId,
      actor: m,
      action: "handoff.start",
      summary: channel === "whatsapp" ? "Iniciou atendimento pelo WhatsApp" : "Iniciou atendimento pelo chat",
      detail: { handoffId: id, channel },
    });
    return this.detail(m.businessId, id);
  }

  /** The conversation moved to WhatsApp: close the loop (status answered) and leave one system line in the web chat. */
  async markAnswered(m: MemberContext, id: string) {
    await this.reopenAnswered(m.businessId);
    const h = await this.load(m.businessId, id);
    if (h.status === "closed") throw conflict("INVALID_STATE", "Este atendimento já foi encerrado.");
    if (h.status === "answered") return this.detail(m.businessId, id);
    const now = new Date();
    await this.human.recordSystemNote({
      businessId: m.businessId,
      conversationId: h.conversationId,
      author: { memberId: m.memberId, name: m.name, roleName: m.roleName },
      text: `${m.name} · ${m.roleName} continuou o atendimento pelo WhatsApp`,
    });
    const brief = (h.brief && typeof h.brief === "object" ? h.brief : {}) as Record<string, unknown>;
    const { inProgress: _drop, ...rest } = brief;
    await this.prisma.client.pharmacistHandoff.update({
      where: { id },
      data: {
        status: "answered",
        answerText: "Atendimento continuado pelo WhatsApp.",
        answeredAt: now,
        answeredByMemberId: m.memberId,
        answeredByName: m.name,
        answeredByRole: m.roleName,
        brief: rest as object,
      },
    });
    await this.accessLog.record({ businessId: m.businessId, actor: m, action: "handoff.whatsapp_answer", summary: "Marcou atendimento como respondido (WhatsApp)", detail: { handoffId: id } });
    return this.detail(m.businessId, id);
  }
}
