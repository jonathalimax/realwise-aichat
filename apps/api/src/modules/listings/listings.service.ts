import { Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { safeHttpUrl } from "../../common/safe-http-url";

export interface ListingItem {
  // Optional — the LLM-extraction path produces listing items with no backing DB row.
  id?: string;
  title: string;
  price?: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  transaction?: string;
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
  // Pagination offset for the chat flow's "➡️ Ver próximo" bubble (see flow.service.ts's
  // resultados handling, which tracks this across turns via flowParams).
  offset?: number;
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

  // Real distinct listingType values for a business's active inventory — used by the chat flow's
  // "busca_tipo" node to build type bubbles from actual rows instead of an LLM extraction call
  // when the business already has a populated Listing table.
  async distinctListingTypes(businessId: string): Promise<string[]> {
    const rows = await this.prisma.client.listing.findMany({
      where: { businessId, status: "active", deletedAt: null },
      distinct: ["listingType"],
      select: { listingType: true },
    });
    return rows.map((r) => r.listingType).filter((t): t is string => typeof t === "string" && t.length > 0);
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
          : filters.ordem === "km_asc"
            ? { mileageKm: "asc" as const }
            : filters.ordem === "ano_desc"
              ? { year: "desc" as const }
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
      skip: filters.offset ?? 0,
      take: limit,
    });

    return rows.map((row) => this.mapRowToListingItem(row));
  }

  // Shared by queryForChat and findMentionedForChat. `url`/image `url` are LLM/owner-settable
  // fields, not system-controlled — run both through safeHttpUrl before ever including them in a
  // chat response, closing a gap where an owner-settable `url` write wasn't previously validated.
  private mapRowToListingItem(row: {
    id: string;
    title: string;
    priceText?: string | null;
    description?: string | null;
    url?: string | null;
    transaction?: string | null;
    images: { url: string }[];
  }): ListingItem {
    const url = safeHttpUrl(row.url ?? undefined);
    const imageUrl = safeHttpUrl(row.images[0]?.url);
    return {
      id: row.id,
      title: row.title,
      ...(row.priceText ? { price: row.priceText } : {}),
      ...(row.description ? { description: row.description } : {}),
      ...(url ? { url } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(row.transaction ? { transaction: row.transaction } : {}),
    };
  }

  // Used by FlowService's "carro_fotos" node: returns one ListingItem per real photo of a specific
  // listing (same title/price on every card) so the frontend's existing ListingCards/
  // ListingDetailOverlay contract renders them as a swipeable gallery — no new frontend contract
  // needed. Returns [] (not a fabricated placeholder) when the listing has no real photos.
  async getImagesForChat(businessId: string, listingId: string): Promise<ListingItem[]> {
    const listing = await this.prisma.client.listing.findFirst({
      where: { id: listingId, businessId, deletedAt: null },
      include: { images: { orderBy: { ordinal: "asc" } } },
    });
    if (!listing) return [];

    const url = safeHttpUrl(listing.url ?? undefined);
    return listing.images
      .map((image) => safeHttpUrl(image.url))
      .filter((imageUrl): imageUrl is string => Boolean(imageUrl))
      .map((imageUrl) => ({
        id: listing.id,
        title: listing.title,
        ...(listing.priceText ? { price: listing.priceText } : {}),
        ...(url ? { url } : {}),
        imageUrl,
      }));
  }

  // Common Portuguese stopwords dropped when extracting "significant" title tokens below — short/
  // generic words like these would otherwise match almost any haystack and defeat the whole point
  // of requiring all significant tokens to be present.
  private static readonly TITLE_STOPWORDS = new Set([
    "para", "com", "sem", "uma", "umas", "uns", "este", "esta", "esse", "essa", "pelo", "pela",
    "casa", "apto", "apartamento", "imovel", "imóvel", "veiculo", "veículo", "carro",
  ]);

  private static normalizeForMatch(text: string): string {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Used by maybeExtractListings's fallback path: general RAG prose about a specific listing (no
  // explicit "quais imóveis" query intent) still gets its real link/photo attached when the
  // visitor message + the generated answer together clearly identify exactly one listing. Matching
  // is deliberately conservative — ambiguous matches (more than `limit` candidates) return []
  // rather than guessing, since attaching the wrong listing's link/photo would be worse than
  // attaching none.
  async findMentionedForChat(businessId: string, haystack: string, limit = 1): Promise<ListingItem[]> {
    const normalizedHaystack = ListingsService.normalizeForMatch(haystack);
    if (!normalizedHaystack) return [];

    const rows = await this.prisma.client.listing.findMany({
      where: { businessId, status: "active", deletedAt: null },
      include: { images: { orderBy: { ordinal: "asc" }, take: 1 } },
    });

    const matches = rows.filter((row) => {
      if (row.referenceCode && normalizedHaystack.includes(ListingsService.normalizeForMatch(row.referenceCode))) {
        return true;
      }

      const titleTokens = ListingsService.normalizeForMatch(row.title)
        .split(" ")
        .filter((token) => token.length >= 4 && !ListingsService.TITLE_STOPWORDS.has(token));
      if (titleTokens.length > 0 && titleTokens.every((token) => normalizedHaystack.includes(token))) {
        return true;
      }

      if (row.neighborhood && row.listingType) {
        const normalizedNeighborhood = ListingsService.normalizeForMatch(row.neighborhood);
        const normalizedListingType = ListingsService.normalizeForMatch(row.listingType);
        if (
          normalizedNeighborhood &&
          normalizedListingType &&
          normalizedHaystack.includes(normalizedNeighborhood) &&
          normalizedHaystack.includes(normalizedListingType)
        ) {
          return true;
        }
      }

      return false;
    });

    if (matches.length === 0 || matches.length > limit) return [];
    return matches.slice(0, limit).map((row) => this.mapRowToListingItem(row));
  }
}
