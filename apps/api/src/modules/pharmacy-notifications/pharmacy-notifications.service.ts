import { Global, Injectable, Logger, Module } from "@nestjs/common";
import { hasPermission, type PermissionSection } from "@realwise/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { MemberContextService } from "../access/member-context.service";
import { dashboardLink, renderEmailButton } from "../../common/email-links";
import { escapeHtml, sendEmail } from "../../common/email";
import { formatBRL } from "../pharmacy-common/format";

export type PharmacyAlertType = "pharmacy_new_order" | "pharmacy_order_waiting" | "pharmacy_new_handoff" | "pharmacy_rx_uploaded" | "pharmacy_stale_sheet";

/**
 * Notifications are NOT disableable (PLAN decision 3): BusinessAlert rows (dashboard banner), email to
 * the business address and to every active member whose role can see the section, and sidebar counts.
 * Staff web-push is not in v1. No health text ever goes into an alert or an email subject.
 */
const REASON_TEXT: Record<string, string> = {
  symptom: "dúvida clínica",
  rx: "receita",
  controlled: "medicamento controlado",
  out_of_stock: "produto em falta",
  product_request: "pedido de produto",
};

export function firstNameOf(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}'-]{2,30}$/u.test(first) ? first : null;
}

/** Generic on purpose: first name + non-clinical reason category, never health text. */
export function handoffAlertMessage(urgent: boolean, firstName: string | null, reason?: string): string {
  const who = firstName ? ` de ${firstName}` : "";
  const why = reason && REASON_TEXT[reason] ? ` (${REASON_TEXT[reason]})` : "";
  return urgent ? `Atendimento farmacêutico URGENTE${who}${why} aguardando resposta` : `Novo atendimento farmacêutico${who}${why} aguardando resposta`;
}

@Global()
@Injectable()
export class PharmacyNotificationsService {
  private readonly logger = new Logger(PharmacyNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contexts: MemberContextService,
  ) {}

  /** Distinct emails: the business address plus active members that have `section` (view or edit). */
  async recipients(businessId: string, section: PermissionSection, level: "view" | "edit" = "view"): Promise<string[]> {
    const [business, members] = await Promise.all([
      this.prisma.client.business.findUnique({ where: { id: businessId }, select: { email: true } }),
      this.prisma.client.businessMember.findMany({
        where: { businessId, status: "active", email: { not: null } },
        include: { role: true, business: { select: { niche: true } } },
      }),
    ]);
    const emails = new Set<string>();
    if (business?.email) emails.add(business.email.trim().toLowerCase());
    for (const m of members) {
      if (!m.email) continue;
      const ctx = this.contexts.toContext(m);
      if (hasPermission(ctx.permissions, section, level)) emails.add(m.email.toLowerCase());
    }
    return [...emails];
  }

  private async createAlert(businessId: string, type: PharmacyAlertType, severity: "info" | "warning" | "critical", message: string, actionLabel: string, actionHref: string) {
    try {
      return await this.prisma.client.businessAlert.create({ data: { businessId, type, severity, message, actionLabel, actionHref } });
    } catch (e) {
      this.logger.warn(`alert write failed (${type}): ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  private async emailAll(businessId: string, section: PermissionSection, subject: string, bodyHtml: string, href: string, label: string) {
    try {
      const to = await this.recipients(businessId, section);
      const link = dashboardLink(`/farmacia/app${href}`);
      const html = `${bodyHtml}${renderEmailButton(label, link)}`;
      for (const email of to) sendEmail(email, subject, html).catch(() => {});
    } catch (e) {
      this.logger.warn(`email fan-out failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Adapter for the chat engine's PharmacyNotifierPort (chat/pharmacy/types.ts): wave 3 can bind
   * PHARMACY_NOTIFIER_PORT to this service. Orders created through OrdersService already notify
   * themselves (handlesNotifications = true), so only handoffs need work here.
   */
  async notify(event: { type: "new_order"; businessId: string; orderCode: string; status: string } | { type: "new_handoff"; businessId: string; handoffId: string; urgent: boolean; reason: string }): Promise<void> {
    if (event.type === "new_handoff") await this.newHandoff({ businessId: event.businessId, urgent: event.urgent, handoffId: event.handoffId, reason: event.reason });
  }

  async newOrder(order: { businessId: string; code: string; totalCents: number; fulfillment: string; autoConfirmed: boolean }) {
    const message = `Novo pedido ${order.code} (${formatBRL(order.totalCents)})${order.autoConfirmed ? ", confirmado automaticamente" : ", aguardando confirmação"}`;
    await this.createAlert(order.businessId, "pharmacy_new_order", "info", message, "Abrir pedidos", "/pedidos");
    await this.emailAll(order.businessId, "pedidos", `Novo pedido ${order.code}`, `<p>${escapeHtml(message)}.</p>`, "/pedidos", "Abrir pedidos");
  }

  /** Created or refreshed (one alert per order) every reminder interval while the order is still waiting. */
  async orderWaiting(order: { businessId: string; code: string }, minutes: number, email = true) {
    const message = `Pedido ${order.code} aguardando há ${minutes} min`;
    const existing = await this.prisma.client.businessAlert.findFirst({
      where: { businessId: order.businessId, type: "pharmacy_order_waiting", dismissedAt: null, message: { contains: order.code } },
    });
    if (existing) {
      await this.prisma.client.businessAlert.update({ where: { id: existing.id }, data: { message, createdAt: new Date() } });
    } else {
      await this.createAlert(order.businessId, "pharmacy_order_waiting", "warning", message, "Abrir pedidos", "/pedidos");
    }
    if (email) await this.emailAll(order.businessId, "pedidos", `Pedido ${order.code} aguardando`, `<p>${escapeHtml(message)}.</p>`, "/pedidos", "Abrir pedidos");
  }

  /** The order was acted on: clear its "new" / "waiting" alerts. */
  async orderHandled(businessId: string, code: string) {
    await this.prisma.client.businessAlert.updateMany({
      where: { businessId, type: { in: ["pharmacy_new_order", "pharmacy_order_waiting"] }, dismissedAt: null, message: { contains: code } },
      data: { dismissedAt: new Date() },
    });
  }

  /**
   * `urgent` raises a critical alert. NEVER pass symptom text: the message names only the customer's first
   * name and a non-clinical reason category. One alert per handoff (the href carries the handoff id), so a
   * retried/duplicated notification never stacks near-identical banners.
   */
  async newHandoff(handoff: { businessId: string; urgent: boolean; handoffId?: string; reason?: string }) {
    const href = handoff.handoffId ? `/atendimento?handoff=${handoff.handoffId}` : "/atendimento";
    if (handoff.handoffId) {
      const existing = await this.prisma.client.businessAlert.findFirst({
        where: { businessId: handoff.businessId, type: "pharmacy_new_handoff", actionHref: href, dismissedAt: null },
        select: { id: true },
      });
      if (existing) return;
    }
    const firstName = handoff.handoffId ? await this.handoffFirstName(handoff.businessId, handoff.handoffId) : null;
    const message = handoffAlertMessage(handoff.urgent, firstName, handoff.reason);
    await this.createAlert(handoff.businessId, "pharmacy_new_handoff", handoff.urgent ? "critical" : "warning", message, "Abrir atendimento", href);
    await this.emailAll(handoff.businessId, "atendimento", handoff.urgent ? "Atendimento urgente" : "Novo atendimento farmacêutico", `<p>${escapeHtml(message)}.</p>`, "/atendimento", "Abrir atendimento");
  }

  private async handoffFirstName(businessId: string, handoffId: string): Promise<string | null> {
    try {
      const h = await this.prisma.client.pharmacistHandoff.findFirst({ where: { id: handoffId, businessId }, select: { leadId: true } });
      if (!h?.leadId) return null;
      const lead = await this.prisma.client.lead.findFirst({ where: { id: h.leadId, businessId }, select: { name: true } });
      return firstNameOf(lead?.name);
    } catch {
      return null;
    }
  }

  async rxUploaded(rx: { businessId: string; code: string }) {
    const message = `Nova receita ${rx.code} para validar`;
    await this.createAlert(rx.businessId, "pharmacy_rx_uploaded", "info", message, "Abrir receitas", "/pedidos?tab=receitas");
    await this.emailAll(rx.businessId, "receitas", `Nova receita ${rx.code}`, `<p>${escapeHtml(message)}.</p>`, "/pedidos?tab=receitas", "Abrir receitas");
  }

  /** Once per sheet: skipped while an active stale-sheet alert exists (a new import dismisses it). */
  async staleSheet(businessId: string, ageHours: number, maxAgeHours: number) {
    const existing = await this.prisma.client.businessAlert.findFirst({ where: { businessId, type: "pharmacy_stale_sheet", dismissedAt: null } });
    if (existing) return false;
    const message = `O estoque do catálogo está desatualizado (${ageHours}h, limite ${maxAgeHours}h). Pedidos novos passam pelo farmacêutico até você importar uma planilha nova.`;
    await this.createAlert(businessId, "pharmacy_stale_sheet", "warning", message, "Importar planilha", "/catalogo/importar");
    const to = await this.recipients(businessId, "importar", "edit");
    const link = dashboardLink("/farmacia/app/catalogo/importar");
    for (const email of to) sendEmail(email, "Estoque desatualizado", `<p>${escapeHtml(message)}</p>${renderEmailButton("Importar planilha", link)}`).catch(() => {});
    return true;
  }
}

@Global()
@Module({
  providers: [PharmacyNotificationsService],
  exports: [PharmacyNotificationsService],
})
export class PharmacyNotificationsModule {}
