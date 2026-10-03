import { Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";

export interface ListingItem {
  title: string;
  price?: string;
  description?: string;
  url?: string;
  imageUrl?: string;
}

export interface ChatQueryFilters {
  listingType?: string;
  transaction?: string;
  priceMin?: number;
  priceMax?: number;
  neighborhood?: string;
  brand?: string;
  model?: string;
  ordem?: string;
}

function generateReferenceCode(): string {
  const hash = createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 6).toUpperCase();
  return `AP-${hash}`;
}

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

  async hasAnyListings(businessId: string): Promise<boolean> {
    const count = await this.prisma.client.listing.count({ where: { businessId, deletedAt: null } });
    return count > 0;
  }

  async listForOwner(businessId: string, filters?: { status?: string; listingType?: string }) {
    return this.prisma.client.listing.findMany({
      where: {
        businessId,
        deletedAt: null,
        ...(filters?.status && { status: filters.status as any }),
        ...(filters?.listingType && { listingType: filters.listingType }),
      },
      include: { images: { orderBy: { ordinal: "asc" } } },
      orderBy: { updatedAt: "desc" },
    });
  }

  async getOne(businessId: string, listingId: string) {
    const listing = await this.prisma.client.listing.findFirst({
      where: { id: listingId, businessId, deletedAt: null },
      include: { images: { orderBy: { ordinal: "asc" } } },
    });
    if (!listing) throw new NotFoundException("Listing not found");
    return listing;
  }

  async update(businessId: string, listingId: string, data: Record<string, unknown>) {
    const existing = await this.prisma.client.listing.findFirst({ where: { id: listingId, businessId, deletedAt: null } });
    if (!existing) throw new NotFoundException("Listing not found");

    const overridden: Record<string, unknown> = { ...((existing.overriddenFields as Record<string, unknown>) ?? {}) };
    for (const key of Object.keys(data)) {
      overridden[key] = true;
    }

    return this.prisma.client.listing.update({
      where: { id: listingId },
      data: { ...data, overriddenFields: overridden as any },
      include: { images: { orderBy: { ordinal: "asc" } } },
    });
  }

  async create(businessId: string, data: Record<string, unknown>) {
    const referenceCode = (data.referenceCode as string) ?? generateReferenceCode();
    return this.prisma.client.listing.create({
      data: {
        businessId,
        referenceCode,
        dedupKey: `manual:${referenceCode}`,
        manuallyCreated: true,
        title: (data.title as string) ?? "Sem título",
        ...data,
      },
      include: { images: { orderBy: { ordinal: "asc" } } },
    });
  }

  async softDelete(businessId: string, listingId: string) {
    const existing = await this.prisma.client.listing.findFirst({ where: { id: listingId, businessId, deletedAt: null } });
    if (!existing) throw new NotFoundException("Listing not found");
    return this.prisma.client.listing.update({ where: { id: listingId }, data: { deletedAt: new Date() } });
  }

  async queryForChat(businessId: string, filters: ChatQueryFilters, limit = 6): Promise<ListingItem[]> {
    const hasPriceFilter = filters.priceMin != null || filters.priceMax != null;
    const priceCondition = hasPriceFilter
      ? {
          OR: [
            {
              priceCents: {
                ...(filters.priceMin != null && { gte: filters.priceMin }),
                ...(filters.priceMax != null && { lte: filters.priceMax }),
              },
            },
            { priceCents: null },
          ],
        }
      : {};

    const orderBy =
      filters.ordem === "preco_asc"
        ? { priceCents: "asc" as const }
        : filters.ordem === "recentes"
          ? { createdAt: "desc" as const }
          : { updatedAt: "desc" as const };

    const rows = await this.prisma.client.listing.findMany({
      where: {
        businessId,
        status: "active",
        deletedAt: null,
        ...(filters.listingType && { listingType: filters.listingType }),
        ...(filters.transaction && { transaction: filters.transaction }),
        ...(filters.neighborhood && { neighborhood: { contains: filters.neighborhood, mode: "insensitive" } }),
        ...(filters.brand && { brand: { equals: filters.brand, mode: "insensitive" } }),
        ...(filters.model && { model: { contains: filters.model, mode: "insensitive" } }),
        ...priceCondition,
      },
      orderBy,
      include: { images: { orderBy: { ordinal: "asc" }, take: 1 } },
      take: limit,
    });

    return rows.map((row) => ({
      title: row.title,
      ...(row.priceText ? { price: row.priceText } : {}),
      ...(row.description ? { description: row.description } : {}),
      ...(row.url ? { url: row.url } : {}),
      ...(row.images[0]?.url ? { imageUrl: row.images[0].url } : {}),
    }));
  }
}
