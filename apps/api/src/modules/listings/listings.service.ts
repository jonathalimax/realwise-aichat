import { Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "crypto";
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

// Manually-created listings have nothing stable to derive a deterministic code from (unlike the
// extraction pipeline's dedupKey-derived codes), so this needs real randomness, not Date.now()+
// Math.random() hashed through sha256 — that's guessable/predictable, not cryptographically random.
function generateReferenceCode(): string {
  return `AP-${randomBytes(5).toString("hex").toUpperCase()}`;
}

// Explicit allowlist of owner-settable fields. Anything not listed here (businessId, id,
// dedupKey, referenceCode, manuallyCreated, createdAt, updatedAt, extractedAt,
// lastSeenInSourceAt, overriddenFields, deletedAt, etc.) must stay system-controlled and is
// silently dropped rather than passed through to Prisma. Allowlisting (rather than
// blacklisting these system fields) means a newly added column is safe-by-default until
// explicitly opened up here.
export interface OwnerSettableListingInput {
  title?: string;
  description?: string;
  priceText?: string;
  priceCents?: number;
  pricePeriod?: string;
  addressLine?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  listingType?: string;
  transaction?: string;
  bedrooms?: number;
  parkingSpots?: number;
  areaM2?: number;
  brand?: string;
  model?: string;
  year?: number;
  mileageKm?: number;
  status?: string;
  url?: string;
}

const OWNER_SETTABLE_LISTING_FIELDS: readonly (keyof OwnerSettableListingInput)[] = [
  "title",
  "description",
  "priceText",
  "priceCents",
  "pricePeriod",
  "addressLine",
  "neighborhood",
  "city",
  "state",
  "listingType",
  "transaction",
  "bedrooms",
  "parkingSpots",
  "areaM2",
  "brand",
  "model",
  "year",
  "mileageKm",
  "status",
  "url",
];

function pickOwnerSettableFields(data: Record<string, unknown>): OwnerSettableListingInput {
  const picked: OwnerSettableListingInput = {};
  for (const key of OWNER_SETTABLE_LISTING_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      (picked as Record<string, unknown>)[key] = data[key];
    }
  }
  return picked;
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

    const allowed = pickOwnerSettableFields(data);

    const overridden: Record<string, unknown> = { ...((existing.overriddenFields as Record<string, unknown>) ?? {}) };
    for (const key of Object.keys(allowed)) {
      overridden[key] = true;
    }

    return this.prisma.client.listing.update({
      // businessId/deletedAt repeated here even though findFirst above already checked them —
      // defense in depth so a future edit that removes/weakens that check can't silently turn
      // this into a cross-tenant write.
      where: { id: listingId, businessId, deletedAt: null },
      data: { ...allowed, status: allowed.status as any, overriddenFields: overridden as any },
      include: { images: { orderBy: { ordinal: "asc" } } },
    });
  }

  async create(businessId: string, data: Record<string, unknown>) {
    const allowed = pickOwnerSettableFields(data);
    const referenceCode = generateReferenceCode();
    return this.prisma.client.listing.create({
      data: {
        businessId,
        referenceCode,
        dedupKey: `manual:${referenceCode}`,
        manuallyCreated: true,
        title: allowed.title ?? "Sem título",
        ...allowed,
        status: allowed.status as any,
      },
      include: { images: { orderBy: { ordinal: "asc" } } },
    });
  }

  async softDelete(businessId: string, listingId: string) {
    const existing = await this.prisma.client.listing.findFirst({ where: { id: listingId, businessId, deletedAt: null } });
    if (!existing) throw new NotFoundException("Listing not found");
    return this.prisma.client.listing.update({ where: { id: listingId, businessId, deletedAt: null }, data: { deletedAt: new Date() } });
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
