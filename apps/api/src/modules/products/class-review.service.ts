import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@realwise/db";
import { PrismaService } from "../../prisma/prisma.service";
import { AccessLogService } from "../access/access-log.service";
import type { MemberContext } from "../access/member-context";
import { CLASS_BADGE, classLabelPlain, type SaleClass } from "../pharmacy-common/labels";
import { parseLimit, sliceCursor } from "../pharmacy-common/format";
import { subtitleFor } from "./product-utils";

export const GROUP_KEYS: SaleClass[] = ["controlled", "prescription", "otc", "unclassified"];

const GROUP_META: Record<SaleClass, { title: string; hint: string }> = {
  controlled: { title: "Controlados propostos", hint: "Revise um a um. Esses produtos nunca podem ser comprados online." },
  prescription: { title: "Com receita propostos", hint: "Exigem receita. O pedido sempre passa pelo farmacêutico." },
  otc: { title: "Venda livre proposta", hint: "Confirme em lote depois de conferir alguns exemplos." },
  unclassified: { title: "Incertos", hint: "Ficam sem classe e não podem ser vendidos no chat até você decidir." },
};

/** "por ..." text: the stored reason, else a label by proposal source. */
export function byText(p: { classProposedBy: string | null; classProposedReason: string | null }): string {
  if (p.classProposedReason) return p.classProposedReason;
  switch (p.classProposedBy) {
    case "sheet":
      return 'coluna "Tarja"';
    case "reference":
      return "referência ANVISA";
    case "ai":
      return "IA";
    case "manual":
      return "manual";
    default:
      return "sem proposta";
  }
}

@Injectable()
export class ClassReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessLog: AccessLogService,
  ) {}

  /** Products of a group still needing a decision (proposal = key, and not confirmed to exactly that class). */
  private pendingWhere(businessId: string, key: SaleClass): Prisma.ProductWhereInput {
    if (key === "unclassified") {
      return {
        businessId,
        deletedAt: null,
        classConfirmedAt: null,
        OR: [{ classProposed: "unclassified" }, { classProposed: null }],
      };
    }
    return { businessId, deletedAt: null, classProposed: key, NOT: { classConfirmedAt: { not: null }, saleClass: key } };
  }

  async overview(businessId: string) {
    const groups = [];
    let confirmedTotal = 0;
    let total = 0;
    for (const key of GROUP_KEYS) {
      const meta = GROUP_META[key];
      const pending = await this.prisma.client.product.count({ where: this.pendingWhere(businessId, key) });
      const confirmed = key === "unclassified" ? 0 : await this.prisma.client.product.count({ where: { businessId, deletedAt: null, classProposed: key, classConfirmedAt: { not: null }, saleClass: key } });
      const samples = await this.prisma.client.product.findMany({
        where: this.pendingWhere(businessId, key),
        orderBy: [{ name: "asc" }],
        take: 3,
        select: { id: true, name: true, classProposedBy: true, classProposedReason: true },
      });
      if (key !== "unclassified") {
        total += pending + confirmed;
        confirmedTotal += confirmed;
      }
      groups.push({
        key,
        title: meta.title,
        short: classLabelPlain(key),
        badge: CLASS_BADGE[key],
        hint: meta.hint,
        count: key === "unclassified" ? pending : pending + confirmed,
        confirmedCount: confirmed,
        done: key !== "unclassified" && pending + confirmed > 0 && pending === 0,
        canConfirm: key !== "unclassified" && pending > 0,
        samples: samples.map((s) => ({ id: s.id, name: s.name, by: byText(s) })),
      });
    }
    return {
      progress: { confirmed: confirmedTotal, total, percent: total ? Math.round((confirmedTotal / total) * 100) : 0 },
      groups,
    };
  }

  private assertKey(key: string): SaleClass {
    if (!GROUP_KEYS.includes(key as SaleClass)) throw new NotFoundException("Grupo não encontrado.");
    return key as SaleClass;
  }

  async groupProducts(businessId: string, rawKey: string, q: { limit?: string; cursor?: string }) {
    const key = this.assertKey(rawKey);
    const limit = parseLimit(q.limit);
    const rows = await this.prisma.client.product.findMany({
      where: this.pendingWhere(businessId, key),
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const { items, nextCursor } = sliceCursor(rows, limit);
    return {
      items: items.map((p) => ({
        id: p.id,
        name: p.name,
        subtitle: subtitleFor(p),
        by: byText(p),
        classProposed: p.classProposed,
        needsReview: !!p.classConfirmedAt && !!p.classProposed && p.classProposed !== p.saleClass,
      })),
      nextCursor,
    };
  }

  /** Bulk confirm: only products NOT yet confirmed (never overrides a pharmacist's earlier decision). */
  async confirmGroup(actor: MemberContext, rawKey: string) {
    const key = this.assertKey(rawKey);
    if (key === "unclassified") throw new BadRequestException({ statusCode: 400, error: "Bad Request", code: "GROUP_NOT_CONFIRMABLE", message: "Produtos incertos precisam ser decididos um a um." });
    const res = await this.prisma.client.product.updateMany({
      where: { businessId: actor.businessId, deletedAt: null, classProposed: key, classConfirmedAt: null },
      data: { saleClass: key, classConfirmedAt: new Date(), classConfirmedBy: actor.memberId },
    });
    if (res.count > 0) {
      await this.accessLog.record({
        businessId: actor.businessId,
        actor,
        action: "class.confirm",
        summary: `Confirmou ${res.count} produtos como ${classLabelPlain(key)}`,
        detail: { saleClass: key, count: res.count },
      });
    }
    return { confirmed: res.count };
  }
}
