import { Injectable } from "@nestjs/common";
import { Prisma } from "@realwise/db";
import { hasPermission } from "@realwise/shared";
import { PrismaService } from "../../prisma/prisma.service";
import type { MemberContext } from "../access/member-context";
import { HandoffsService } from "../handoffs/handoffs.service";
import { PharmacySettingsService } from "../pharmacy-settings/pharmacy-settings.service";
import { ORDER_STATUS_BADGE, ORDER_STATUS_LABEL, handoffTag, type OrderStatus } from "../pharmacy-common/labels";
import { formatBRL, formatBRLShort, minutesSince } from "../pharmacy-common/format";
import { sheetAgeLabel } from "../pharmacy-common/sheet";
import { loadOperationMode } from "../pharmacy-common/operation-mode";
import { kindLabel, rxPendingOf, staleAtOrderTime, type OrderRow } from "../orders/order-dto";
import { whoLabel } from "../handoffs/handoff-dto";
import { buildInsights, peakHourOf } from "./insights";
import { addDays, bucketIndex, bucketLabels, deltaNote, localParts, parseRange, shortName, startOfLocalDay, windowFor, type Range } from "./time-buckets";

const ACTIVE_COURIER_STATUSES: OrderStatus[] = ["confirmed", "out_for_delivery", "ready_for_pickup"];

@Injectable()
export class PharmacyDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PharmacySettingsService,
    private readonly handoffs: HandoffsService,
  ) {}

  private async tz(businessId: string): Promise<string> {
    const b = await this.prisma.client.business.findUnique({ where: { id: businessId }, select: { timezone: true } });
    return b?.timezone ?? "America/Sao_Paulo";
  }

  // ------------------------------------------------------------------ GET /dashboard/summary

  async summary(m: MemberContext, rangeRaw: unknown) {
    const range = parseRange(rangeRaw);
    const now = new Date();
    const timeZone = await this.tz(m.businessId);
    const win = windowFor(range, now, timeZone);
    const todayStart = startOfLocalDay(now, timeZone);
    const yesterdayStart = addDays(todayStart, -1);
    const settings = await this.settings.getRow(m.businessId);
    const sheet = await this.settings.latestSheet(m.businessId, settings.stockMaxAgeHours);
    // Attendance mode (chosen or forced by the plan): no orders, stock or catalog numbers at all.
    const mode = await loadOperationMode(this.prisma.client, m.businessId);
    const commerce = mode.effective === "commerce";
    const can = {
      pedidos: commerce && hasPermission(m.permissions, "pedidos", "view"),
      atendimento: hasPermission(m.permissions, "atendimento", "view"),
      receitas: commerce && hasPermission(m.permissions, "receitas", "view"),
      analises: hasPermission(m.permissions, "analises", "view"),
      catalogo: commerce && hasPermission(m.permissions, "catalogo", "view"),
      classes: commerce && hasPermission(m.permissions, "classes", "view"),
      importar: commerce && hasPermission(m.permissions, "importar", "view"),
    };
    const stock = { asOf: sheet.asOf, ageHours: sheet.ageHours, maxAgeHours: sheet.maxAgeHours, stale: sheet.stale, display: sheetAgeLabel(sheet.ageHours) };
    const roleFocus: "orders" | "handoffs" | "deliveries" = m.ownDeliveriesOnly ? "deliveries" : m.roleKey === "pharmacist" || (m.requiresCrf && m.permissions.atendimento === "edit") ? "handoffs" : "orders";

    if (m.ownDeliveriesOnly) return this.courierSummary(m, range, now, stock, roleFocus);

    const kpis: Array<{ key: string; label: string; value: number; display: string; note: string }> = [];
    let needsAction: unknown[] = [];
    let handoffsList: unknown[] = [];
    if (can.pedidos) {
      const [today, yesterday, pending, rxPending] = await Promise.all([
        this.prisma.client.order.count({ where: { businessId: m.businessId, createdAt: { gte: todayStart } } }),
        this.prisma.client.order.count({ where: { businessId: m.businessId, createdAt: { gte: yesterdayStart, lt: todayStart } } }),
        this.prisma.client.order.count({ where: { businessId: m.businessId, status: "pending_pharmacist" } }),
        can.receitas ? this.prisma.client.prescriptionUpload.count({ where: { businessId: m.businessId, status: "pending" } }) : Promise.resolve(0),
      ]);
      kpis.push({ key: "orders_today", label: "Pedidos hoje", value: today, display: String(today), note: deltaNote(today, yesterday) });
      kpis.push({ key: "awaiting_action", label: "Aguardando ação", value: pending, display: String(pending), note: rxPending ? `${rxPending} ${rxPending === 1 ? "receita" : "receitas"} para validar` : pending ? "Pedidos novos para confirmar" : "Nada pendente" });
      const rows = await this.prisma.client.order.findMany({
        where: { businessId: m.businessId, status: "pending_pharmacist" },
        include: { lead: { select: { id: true, name: true, phone: true, email: true } }, items: true, prescriptions: { select: { id: true, number: true, status: true } } },
        orderBy: { createdAt: "asc" },
        take: 10,
      });
      needsAction = rows.map((o) => {
        const row = o as unknown as OrderRow;
        const reason = rxPendingOf(row) ? "validate_rx" : staleAtOrderTime(row, settings.stockMaxAgeHours) ? "stale_stock" : "new";
        return {
          orderId: o.id,
          code: o.code,
          customerName: shortName(o.lead.name),
          totalCents: o.totalCents,
          kindLabel: kindLabel(row),
          statusLabel: ORDER_STATUS_LABEL[o.status as OrderStatus],
          badge: ORDER_STATUS_BADGE[o.status as OrderStatus],
          reason: reason === "stale_stock" ? "stale_stock" : reason,
          waitingMinutes: minutesSince(o.createdAt, now.getTime()),
        };
      });
    }
    if (can.atendimento) {
      await this.handoffs.reopenAnswered(m.businessId);
      const [openCount, urgentCount, rows] = await Promise.all([
        this.prisma.client.pharmacistHandoff.count({ where: { businessId: m.businessId, status: "open" } }),
        this.prisma.client.pharmacistHandoff.count({ where: { businessId: m.businessId, status: "open", urgent: true } }),
        this.prisma.client.pharmacistHandoff.findMany({ where: { businessId: m.businessId, status: "open" }, orderBy: [{ urgent: "desc" }, { createdAt: "asc" }], take: 5 }),
      ]);
      kpis.push({ key: "open_handoffs", label: "Atendimentos abertos", value: openCount, display: String(openCount), note: urgentCount ? `${urgentCount} urgente${urgentCount > 1 ? "s" : ""}` : openCount ? "Nenhum urgente" : "Nada aguardando" });
      const leadIds = [...new Set(rows.map((r) => r.leadId).filter((x): x is string => !!x))];
      const leads = leadIds.length ? await this.prisma.client.lead.findMany({ where: { businessId: m.businessId, id: { in: leadIds } }, select: { id: true, name: true } }) : [];
      const leadById = new Map(leads.map((l) => [l.id, l]));
      handoffsList = rows.map((h) => {
        const tag = handoffTag(h.reason as any, h.urgent);
        return { id: h.id, who: whoLabel({ lead: h.leadId ? leadById.get(h.leadId) ?? null : null, brief: h.brief }), tag: tag.tag, badge: tag.tagBadge, summary: h.summary, createdAt: h.createdAt.toISOString() };
      });
    }
    if (!commerce) {
      kpis.push(...(await this.attendanceKpis(m.businessId, win.from, todayStart, can.atendimento)));
    }
    if (can.analises && commerce) {
      const delivered = await this.prisma.client.order.aggregate({ where: { businessId: m.businessId, status: "delivered", deliveredAt: { gte: todayStart } }, _sum: { totalCents: true }, _count: { _all: true } });
      const revenue = delivered._sum.totalCents ?? 0;
      const n = delivered._count._all;
      kpis.push({ key: "revenue_today", label: "Faturamento hoje", value: revenue, display: formatBRL(revenue), note: n ? `Ticket médio ${formatBRL(Math.round(revenue / n))}` : "Pedidos concluídos hoje" });
    }

    const chart = can.pedidos ? await this.chart(m, range, now, timeZone, win.title, can.analises) : null;
    const funnel = can.analises && commerce ? await this.funnel(m.businessId, win.from) : null;
    const insights = await this.insights(m, win.days, win.from, now, timeZone, settings, sheet, can);
    return {
      range,
      generatedAt: now.toISOString(),
      mode: mode.effective,
      roleFocus: commerce ? roleFocus : "handoffs",
      kpis,
      stock: commerce ? stock : null,
      needsAction,
      handoffs: handoffsList,
      chart,
      funnel,
      insights,
    };
  }

  /** Attendance KPIs: open handoffs come from the shared block; these add answered today, average first response, conversations. */
  private async attendanceKpis(businessId: string, from: Date, todayStart: Date, withHandoffs: boolean) {
    const [conversations, answeredToday, answeredInRange] = await Promise.all([
      this.prisma.client.conversation.count({ where: { businessId, startedAt: { gte: from } } }),
      withHandoffs ? this.prisma.client.pharmacistHandoff.count({ where: { businessId, answeredAt: { gte: todayStart } } }) : Promise.resolve(0),
      withHandoffs ? this.prisma.client.pharmacistHandoff.findMany({ where: { businessId, answeredAt: { gte: from } }, select: { createdAt: true, answeredAt: true }, take: 5000 }) : Promise.resolve([]),
    ]);
    const kpis: Array<{ key: string; label: string; value: number; display: string; note: string }> = [];
    if (withHandoffs) {
      kpis.push({ key: "answered_today", label: "Respondidos hoje", value: answeredToday, display: String(answeredToday), note: answeredToday ? "Atendimentos respondidos pela equipe" : "Nenhuma resposta ainda hoje" });
      const waits = answeredInRange.filter((h) => h.answeredAt).map((h) => ((h.answeredAt as Date).getTime() - h.createdAt.getTime()) / 60000);
      const avg = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null;
      kpis.push({
        key: "avg_first_response",
        label: "Tempo médio de resposta",
        value: avg === null ? 0 : Math.round(avg),
        display: avg === null ? "-" : avg < 60 ? `${Math.max(1, Math.round(avg))} min` : `${Math.floor(avg / 60)} h ${Math.round(avg % 60)} min`,
        note: avg === null ? "Sem respostas no período" : `${waits.length} ${waits.length === 1 ? "resposta" : "respostas"} no período`,
      });
    }
    kpis.push({ key: "conversations", label: "Conversas", value: conversations, display: String(conversations), note: "Iniciadas no período" });
    return kpis;
  }

  private async courierSummary(m: MemberContext, range: Range, now: Date, stock: unknown, roleFocus: string) {
    const rows = await this.prisma.client.order.findMany({
      where: { businessId: m.businessId, courierMemberId: m.memberId, status: { in: ACTIVE_COURIER_STATUSES } },
      include: { lead: { select: { id: true, name: true, phone: true, email: true } }, items: true, prescriptions: { select: { id: true, number: true, status: true } } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    return {
      range,
      generatedAt: now.toISOString(),
      roleFocus,
      kpis: [{ key: "my_deliveries", label: "Minhas entregas", value: rows.length, display: String(rows.length), note: rows.length ? "Atribuídas a você" : "Nenhuma entrega atribuída" }],
      stock,
      needsAction: rows.map((o) => ({
        orderId: o.id,
        code: o.code,
        customerName: shortName(o.lead.name),
        totalCents: o.totalCents,
        kindLabel: kindLabel(o as unknown as OrderRow),
        statusLabel: ORDER_STATUS_LABEL[o.status as OrderStatus],
        badge: ORDER_STATUS_BADGE[o.status as OrderStatus],
        reason: "new",
        waitingMinutes: minutesSince(o.createdAt, now.getTime()),
      })),
      handoffs: [],
      chart: null,
      funnel: null,
      insights: [],
    };
  }

  private async chart(m: MemberContext, range: Range, now: Date, timeZone: string, title: string, withRevenue: boolean) {
    const win = windowFor(range, now, timeZone);
    const labels = bucketLabels(range, now, timeZone);
    const buckets = labels.map((label) => ({ label, orders: 0, ...(withRevenue ? { revenueCents: 0 } : {}), delivery: 0, pickup: 0 })) as Array<Record<string, any>>;
    const [created, delivered] = await Promise.all([
      this.prisma.client.order.findMany({ where: { businessId: m.businessId, createdAt: { gte: win.from }, status: { notIn: ["canceled", "rejected"] } }, select: { createdAt: true, fulfillment: true }, take: 50000 }),
      withRevenue ? this.prisma.client.order.findMany({ where: { businessId: m.businessId, status: "delivered", deliveredAt: { gte: win.from } }, select: { deliveredAt: true, totalCents: true }, take: 50000 }) : Promise.resolve([]),
    ]);
    for (const o of created) {
      const i = bucketIndex(range, o.createdAt, now, timeZone);
      if (i < 0) continue;
      buckets[i].orders++;
      buckets[i][o.fulfillment === "delivery" ? "delivery" : "pickup"]++;
    }
    for (const o of delivered) {
      const i = o.deliveredAt ? bucketIndex(range, o.deliveredAt, now, timeZone) : -1;
      if (i >= 0) buckets[i].revenueCents += o.totalCents;
    }
    return { title, buckets };
  }

  private async funnel(businessId: string, from: Date) {
    const [conversations, carts, orders] = await Promise.all([
      this.prisma.client.conversation.count({ where: { businessId, startedAt: { gte: from } } }),
      this.prisma.client.analyticsEvent.count({ where: { businessId, name: "pharmacy_cart_created", occurredAt: { gte: from } } }),
      this.prisma.client.order.count({ where: { businessId, createdAt: { gte: from } } }),
    ]);
    return { conversations, carts, orders, conversionRate: conversations ? Math.round((orders / conversations) * 1000) / 1000 : 0 };
  }

  private async insights(m: MemberContext, days: number, from: Date, now: Date, timeZone: string, settings: { orderReminderMinutes: number }, sheet: { stale: boolean; ageHours: number | null; maxAgeHours: number }, can: Record<string, boolean>) {
    const [unmet, orders, unclassifiedCount, confirmed] = await Promise.all([
      can.analises ? this.unmetDemand(m.businessId, from, 1) : Promise.resolve([]),
      can.analises ? this.prisma.client.order.findMany({ where: { businessId: m.businessId, createdAt: { gte: from } }, select: { createdAt: true } }) : Promise.resolve([]),
      can.classes ? this.prisma.client.product.count({ where: { businessId: m.businessId, deletedAt: null, active: true, classConfirmedAt: null, OR: [{ classProposed: null }, { classProposed: "unclassified" }] } }) : Promise.resolve(0),
      can.pedidos ? this.prisma.client.order.findMany({ where: { businessId: m.businessId, autoConfirmed: false, confirmedAt: { gte: from } }, select: { createdAt: true, confirmedAt: true }, take: 5000 }) : Promise.resolve([]),
    ]);
    const waits = confirmed.filter((o) => o.confirmedAt).map((o) => ((o.confirmedAt as Date).getTime() - o.createdAt.getTime()) / 60000);
    return buildInsights({
      days,
      topUnmet: unmet[0] ? { name: unmet[0].name, requests: unmet[0].requests } : null,
      peakHour: peakHourOf(orders.map((o) => localParts(o.createdAt, timeZone).hour)),
      unclassifiedCount,
      slowConfirm: waits.length ? { avgMinutes: waits.reduce((a, b) => a + b, 0) / waits.length, reminderMinutes: settings.orderReminderMinutes, orders: waits.length } : null,
      staleSheet: sheet.stale && sheet.ageHours !== null ? { ageHours: sheet.ageHours, maxAgeHours: sheet.maxAgeHours } : null,
      can: { catalogo: can.catalogo, classes: can.classes, importar: can.importar, analises: can.analises, pedidos: can.pedidos },
    });
  }

  /** `pharmacy_product_requested` with inStock=false, grouped by product (ids and enums only, no text). */
  async unmetDemand(businessId: string, from: Date, limit = 5): Promise<Array<{ productId: string; name: string; requests: number }>> {
    const events = await this.prisma.client.analyticsEvent.findMany({
      where: { businessId, name: "pharmacy_product_requested", occurredAt: { gte: from } },
      select: { properties: true },
      take: 50000,
    });
    const counts = new Map<string, number>();
    for (const e of events) {
      const p = (e.properties ?? {}) as { productId?: unknown; inStock?: unknown };
      if (p.inStock === false && typeof p.productId === "string") counts.set(p.productId, (counts.get(p.productId) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    if (!top.length) return [];
    const products = await this.prisma.client.product.findMany({ where: { businessId, id: { in: top.map(([id]) => id) } }, select: { id: true, name: true, presentation: true } });
    const byId = new Map(products.map((p) => [p.id, p]));
    return top.filter(([id]) => byId.has(id)).map(([id, requests]) => ({ productId: id, name: byId.get(id)!.name, requests }));
  }

  // ------------------------------------------------------------------ GET /analytics/pharmacy/overview

  async overview(m: MemberContext, rangeRaw: unknown) {
    const range = parseRange(rangeRaw);
    const now = new Date();
    const timeZone = await this.tz(m.businessId);
    const win = windowFor(range, now, timeZone);
    const businessId = m.businessId;
    if ((await loadOperationMode(this.prisma.client, businessId)).effective === "attendance") return this.attendanceOverview(m, range, win.title, win.from);
    const labels = bucketLabels(range, now, timeZone);
    const buckets = labels.map((label) => ({ label, revenueCents: 0 }));
    const [delivered, orderCount, conversations, handoffs, controlled, redFlag, top, unmetDemand] = await Promise.all([
      this.prisma.client.order.findMany({ where: { businessId, status: "delivered", deliveredAt: { gte: win.from } }, select: { deliveredAt: true, totalCents: true }, take: 50000 }),
      this.prisma.client.order.count({ where: { businessId, createdAt: { gte: win.from }, status: { notIn: ["canceled", "rejected"] } } }),
      this.prisma.client.conversation.count({ where: { businessId, startedAt: { gte: win.from } } }),
      this.prisma.client.pharmacistHandoff.count({ where: { businessId, createdAt: { gte: win.from } } }),
      this.prisma.client.analyticsEvent.count({ where: { businessId, name: "pharmacy_controlled_inquiry", occurredAt: { gte: win.from } } }),
      this.prisma.client.analyticsEvent.count({ where: { businessId, name: "pharmacy_red_flag", occurredAt: { gte: win.from } } }),
      this.topProducts(businessId, win.from),
      this.unmetDemand(businessId, win.from, 10),
    ]);
    let revenue = 0;
    for (const o of delivered) {
      revenue += o.totalCents;
      const i = o.deliveredAt ? bucketIndex(range, o.deliveredAt, now, timeZone) : -1;
      if (i >= 0) buckets[i].revenueCents += o.totalCents;
    }
    const avg = delivered.length ? Math.round(revenue / delivered.length) : 0;
    const conversion = conversations ? Math.round((orderCount / conversations) * 1000) / 1000 : 0;
    const general = Math.max(0, conversations - orderCount - handoffs - controlled - redFlag);
    const pct = (n: number) => (conversations ? Math.round((n / conversations) * 100) : 0);
    return {
      range,
      label: win.title,
      kpis: [
        { key: "revenue", label: "Faturamento", value: revenue, display: formatBRLShort(revenue), note: "Pedidos concluídos" },
        { key: "orders", label: "Pedidos", value: orderCount, display: String(orderCount), note: "Entrega e retirada" },
        { key: "avg_ticket", label: "Ticket médio", value: avg, display: formatBRL(avg), note: "Por pedido" },
        { key: "conversion", label: "Conversão do chat", value: conversion, display: `${(conversion * 100).toFixed(1).replace(".", ",")}%`, note: "Conversa que virou pedido" },
      ],
      chart: { buckets },
      triage: [
        { key: "orders", label: "Viraram pedido", count: orderCount, percent: pct(orderCount) },
        { key: "handoff", label: "Encaminhadas ao farmacêutico", count: handoffs, percent: pct(handoffs) },
        { key: "controlled", label: "Controlado: só informação", count: controlled, percent: pct(controlled) },
        { key: "red_flag", label: "Sinal de alerta (urgente)", count: redFlag, percent: pct(redFlag) },
        { key: "general", label: "Dúvidas gerais", count: general, percent: pct(general) },
      ],
      topProducts: top,
      unmetDemand: unmetDemand.map((u) => ({ productId: u.productId, name: u.name, requests: u.requests })),
    };
  }

  /** Analytics of an attendance-mode pharmacy: conversations and pharmacist handoffs only (no revenue, orders or products). */
  private async attendanceOverview(m: MemberContext, range: Range, label: string, from: Date) {
    const businessId = m.businessId;
    const [conversations, handoffs, redFlag, productRequests, answered] = await Promise.all([
      this.prisma.client.conversation.count({ where: { businessId, startedAt: { gte: from } } }),
      this.prisma.client.pharmacistHandoff.count({ where: { businessId, createdAt: { gte: from } } }),
      this.prisma.client.analyticsEvent.count({ where: { businessId, name: "pharmacy_red_flag", occurredAt: { gte: from } } }),
      this.prisma.client.pharmacistHandoff.count({ where: { businessId, reason: "product_request", createdAt: { gte: from } } }),
      this.prisma.client.pharmacistHandoff.count({ where: { businessId, answeredAt: { gte: from } } }),
    ]);
    const pct = (n: number) => (conversations ? Math.round((n / conversations) * 100) : 0);
    return {
      range,
      label,
      mode: "attendance" as const,
      kpis: [
        { key: "conversations", label: "Conversas", value: conversations, display: String(conversations), note: "Iniciadas no período" },
        { key: "handoffs", label: "Encaminhadas ao farmacêutico", value: handoffs, display: String(handoffs), note: `${pct(handoffs)}% das conversas` },
        { key: "product_requests", label: "Perguntas sobre produtos", value: productRequests, display: String(productRequests), note: "O farmacêutico confirma estoque e preço" },
        { key: "answered", label: "Respondidos", value: answered, display: String(answered), note: "Atendimentos respondidos" },
      ],
      chart: { buckets: [] },
      triage: [
        { key: "handoff", label: "Encaminhadas ao farmacêutico", count: handoffs, percent: pct(handoffs) },
        { key: "red_flag", label: "Sinal de alerta (urgente)", count: redFlag, percent: pct(redFlag) },
        { key: "general", label: "Dúvidas gerais", count: Math.max(0, conversations - handoffs), percent: pct(Math.max(0, conversations - handoffs)) },
      ],
      topProducts: [],
      unmetDemand: [],
    };
  }

  private async topProducts(businessId: string, from: Date) {
    const rows = await this.prisma.client.$queryRaw<Array<{ productId: string; units: bigint; revenue: bigint }>>(Prisma.sql`
      SELECT i."productId" AS "productId", SUM(i."qty")::bigint AS units, SUM(i."qty" * i."unitPriceCents")::bigint AS revenue
      FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
      WHERE o."businessId" = ${businessId} AND o."createdAt" >= ${from} AND o."status" NOT IN ('canceled', 'rejected')
      GROUP BY i."productId" ORDER BY units DESC LIMIT 10`);
    if (!rows.length) return [];
    const products = await this.prisma.client.product.findMany({ where: { businessId, id: { in: rows.map((r) => r.productId) } }, select: { id: true, name: true } });
    const byId = new Map(products.map((p) => [p.id, p.name]));
    return rows.map((r) => ({ productId: r.productId, name: byId.get(r.productId) ?? "Produto removido", units: Number(r.units), revenueCents: Number(r.revenue) }));
  }

  // ------------------------------------------------------------------ GET /notifications/summary

  async notificationsSummary(m: MemberContext) {
    const out: Record<string, unknown> = {};
    if (m.niche !== "farmacia") return out;
    const settings = await this.settings.getRow(m.businessId);
    const commerce = (await loadOperationMode(this.prisma.client, m.businessId)).effective === "commerce";
    const scope = m.ownDeliveriesOnly ? { courierMemberId: m.memberId } : {};
    if (commerce && hasPermission(m.permissions, "pedidos", "view")) {
      const cutoff = new Date(Date.now() - settings.orderReminderMinutes * 60000);
      const [newCount, waiting] = await Promise.all([
        this.prisma.client.order.count({ where: { businessId: m.businessId, status: "pending_pharmacist", ...scope } }),
        this.prisma.client.order.count({ where: { businessId: m.businessId, status: "pending_pharmacist", createdAt: { lt: cutoff }, ...scope } }),
      ]);
      out.orders = { new: newCount, waitingOverMinutes: waiting };
    }
    if (hasPermission(m.permissions, "atendimento", "view")) {
      await this.handoffs.reopenAnswered(m.businessId);
      const [open, urgent] = await Promise.all([
        this.prisma.client.pharmacistHandoff.count({ where: { businessId: m.businessId, status: "open" } }),
        this.prisma.client.pharmacistHandoff.count({ where: { businessId: m.businessId, status: "open", urgent: true } }),
      ]);
      out.handoffs = { open, urgent };
    }
    if (commerce && hasPermission(m.permissions, "receitas", "view")) {
      out.prescriptions = { pending: await this.prisma.client.prescriptionUpload.count({ where: { businessId: m.businessId, status: "pending" } }) };
    }
    if (commerce && (hasPermission(m.permissions, "importar", "view") || hasPermission(m.permissions, "catalogo", "view") || hasPermission(m.permissions, "farmacia", "view"))) {
      const sheet = await this.settings.latestSheet(m.businessId, settings.stockMaxAgeHours);
      out.sheet = { stale: sheet.stale, ageHours: sheet.ageHours };
    }
    return out;
  }
}
