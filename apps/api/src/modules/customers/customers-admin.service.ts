import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { formatPhoneBr, initialsOf, parseLimit, sliceCursor } from "../pharmacy-common/format";
import { ORDER_STATUS_LABEL, type OrderStatus } from "../pharmacy-common/labels";
import { maskAddress } from "./address-utils";

/** Staff-side customer list (clientes). Never includes health data: no symptoms, briefs or prescriptions. */
@Injectable()
export class CustomersAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(businessId: string, q: { q?: string; limit?: string; cursor?: string }) {
    const limit = parseLimit(q.limit);
    const search = q.q?.trim();
    // Digits only count as a phone search when the whole query looks like a phone: "Ana 123" must not match every number containing 123.
    const digits = search && /^[\d\s()+.-]+$/.test(search) ? search.replace(/\D/g, "") : "";
    const where = {
      businessId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
              ...(digits.length >= 3 ? [{ phoneNormalized: { contains: digits } }] : []),
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.lead.findMany({
        where,
        orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
        take: limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
      this.prisma.client.lead.count({ where }),
    ]);
    const { items, nextCursor } = sliceCursor(rows, limit);
    const ids = items.map((l) => l.id);
    const [orderCounts, deliveryCounts, addresses] = await Promise.all([
      this.prisma.client.order.groupBy({ by: ["leadId"], where: { businessId, leadId: { in: ids } }, _count: { _all: true } }),
      this.prisma.client.order.groupBy({ by: ["leadId"], where: { businessId, leadId: { in: ids }, fulfillment: "delivery" }, _count: { _all: true } }),
      this.prisma.client.customerAddress.findMany({ where: { businessId, leadId: { in: ids }, isDefault: true, supersededAt: null } }),
    ]);
    const orders = new Map(orderCounts.map((g) => [g.leadId, g._count._all]));
    const deliveries = new Map(deliveryCounts.map((g) => [g.leadId, g._count._all]));
    const addrByLead = new Map(addresses.map((a) => [a.leadId, a]));
    return {
      items: items.map((l) => this.listDto(l, orders.get(l.id) ?? 0, deliveries.get(l.id) ?? 0, addrByLead.get(l.id) ?? null)),
      nextCursor,
      total,
    };
  }

  private listDto(
    l: { id: string; name: string | null; phone: string; phoneNormalized: string; email: string | null; lastSeenAt: Date },
    ordersCount: number,
    deliveryCount: number,
    address: { id: string; cep: string; street: string; number: string; district: string; city: string; state: string; isDefault: boolean; complement: string | null; reference: string | null } | null,
  ) {
    const pickupOnly = ordersCount > 0 && deliveryCount === 0;
    return {
      id: l.id,
      name: l.name ?? "Cliente",
      initials: initialsOf(l.name),
      phone: l.phoneNormalized || l.phone,
      phoneFormatted: formatPhoneBr(l.phoneNormalized || l.phone),
      email: l.email,
      ordersCount,
      lastActivityAt: l.lastSeenAt.toISOString(),
      // The street number is hidden by default; staff see it on the order itself.
      addressLabel: pickupOnly && !address ? "Retirada em loja" : address ? maskAddress(address).label : null,
    };
  }

  async get(businessId: string, id: string) {
    const lead = await this.prisma.client.lead.findFirst({ where: { id, businessId } });
    if (!lead) throw new NotFoundException("Cliente não encontrado.");
    const [orders, consent, addresses, counts] = await Promise.all([
      this.prisma.client.order.findMany({ where: { businessId, leadId: id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, code: true, createdAt: true, totalCents: true, status: true, fulfillment: true } }),
      this.prisma.client.consentRecord.findFirst({ where: { businessId, leadId: id, withdrawnAt: null }, orderBy: { grantedAt: "desc" } }),
      this.prisma.client.customerAddress.findMany({ where: { businessId, leadId: id }, orderBy: { createdAt: "desc" } }),
      this.prisma.client.order.groupBy({ by: ["fulfillment"], where: { businessId, leadId: id }, _count: { _all: true } }),
    ]);
    const total = counts.reduce((n, c) => n + c._count._all, 0);
    const delivery = counts.find((c) => c.fulfillment === "delivery")?._count._all ?? 0;
    const current = addresses.find((a) => a.isDefault && !a.supersededAt) ?? null;
    return {
      ...this.listDto(lead, total, delivery, current),
      consent: consent ? { grantedAt: consent.grantedAt.toISOString(), purposes: consent.purposes, version: consent.consentTextVersion } : null,
      addresses: addresses.map((a) => ({ ...maskAddress(a), createdAt: a.createdAt.toISOString(), supersededAt: a.supersededAt ? a.supersededAt.toISOString() : null })),
      orders: orders.map((o) => ({ id: o.id, code: o.code, createdAt: o.createdAt.toISOString(), totalCents: o.totalCents, status: o.status, statusLabel: ORDER_STATUS_LABEL[o.status as OrderStatus] })),
    };
  }
}
