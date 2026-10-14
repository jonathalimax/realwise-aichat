import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { MemberContext } from "./member-context";

/** Dotted action code -> category badge shown in the UI. First matching prefix wins. */
const CATEGORY_BY_PREFIX: Array<[string, string]> = [
  ["prescription.", "Receita"],
  ["handoff.", "Atendimento"],
  ["order.", "Pedido"],
  ["team.", "Equipe"],
  ["role.", "Equipe"],
  ["catalog.", "Catálogo"],
  ["class.", "Catálogo"],
  ["settings.", "Configurações"],
  ["branding.", "Configurações"],
  ["billing.", "Plano"],
  ["auth.", "Acesso"],
];

export function categoryForAction(action: string): string {
  return CATEGORY_BY_PREFIX.find(([p]) => action.startsWith(p))?.[1] ?? "Outros";
}

export interface RecordAccessLogInput {
  businessId: string;
  /** The acting member (preferred) or a system actor with only a name. */
  actor?: Pick<MemberContext, "memberId" | "name"> | { memberId: null; name: string } | null;
  /**
   * Dotted action code. Defined codes (see docs/pharmacy/API.md): auth.login, auth.login_failed,
   * team.invite, team.invite_resend, team.invite_accept, team.role_change, team.disable, team.enable,
   * team.remove, role.create, role.update, role.delete, prescription.approve, prescription.reject,
   * prescription.download, handoff.answer, handoff.close, class.confirm, catalog.import,
   * catalog.product_update, order.confirm, order.out, order.done, order.cancel, order.assign_courier,
   * settings.update, branding.update, billing.change.
   */
  action: string;
  /** Human target, e.g. "RX-309", "PED-4821", "Tiago Lima". */
  target?: string | null;
  /** One pt-BR sentence shown in the UI list, e.g. "Aprovou RX-309 do pedido PED-4809". Stored as detail.summary. */
  summary?: string;
  /** Small JSON. NEVER put health data (symptoms, prescription content, patient text) here. */
  detail?: Record<string, unknown>;
}

@Injectable()
export class AccessLogService {
  private readonly logger = new Logger(AccessLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Never throws: an audit-log failure must not break the business action that triggered it. */
  async record(input: RecordAccessLogInput): Promise<void> {
    try {
      await this.prisma.client.accessLogEntry.create({
        data: {
          businessId: input.businessId,
          memberId: input.actor?.memberId ?? null,
          memberName: input.actor?.name ?? null,
          action: input.action,
          category: categoryForAction(input.action),
          target: input.target ?? null,
          detail: { ...(input.detail ?? {}), ...(input.summary ? { summary: input.summary } : {}) } as object,
        },
      });
    } catch (err) {
      this.logger.warn(`access log write failed (${input.action}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async list(
    businessId: string,
    opts: { memberId?: string; category?: string; from?: Date; to?: Date; limit?: number; cursor?: string },
  ) {
    const limit = Math.min(Math.max(Number.isFinite(opts.limit) ? (opts.limit as number) : 50, 1), 200);
    const rows = await this.prisma.client.accessLogEntry.findMany({
      where: {
        businessId,
        ...(opts.memberId ? { memberId: opts.memberId } : {}),
        ...(opts.category ? { category: opts.category } : {}),
        ...(opts.from || opts.to ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }
}
