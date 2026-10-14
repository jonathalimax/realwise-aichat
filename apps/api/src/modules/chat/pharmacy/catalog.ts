// Product resolution against the business catalog (normalized name / ingredient / presentation,
// with an edit-distance fallback for typos) and the data helpers around it. The sale class of a
// product ALWAYS comes from its database row.

import { extractQty, fold, foldProduct, productTokens } from "./text";
import { gateForProduct } from "./rules";
import type { DeliveryArea, OpeningHoursEntry, PharmacySettingsView, ProductRow } from "./types";

export interface PrismaLike {
  client: any;
}

export interface ProductMatch {
  product: ProductRow;
  score: number;
}

export interface Resolution {
  status: "none" | "single" | "ambiguous";
  matches: ProductMatch[];
  qty: number | null;
}

const DOSE_TOKEN = /^\d+(?:[.,]\d+)?(?:mg|mcg|g|ml|ui|%|comprimidos?|comp|caps?|capsulas?|gotas?)$/;
const DIGITS_ONLY = /^\d{1,3}$/;

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    let rowMin = prev[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
      rowMin = Math.min(rowMin, prev[j]);
    }
    if (rowMin > max) return max + 1;
  }
  return prev[b.length];
}

function tokenMatchesWord(token: string, word: string, fuzzy: boolean): boolean {
  if (token === word) return true;
  if (token.length >= 5 && word.startsWith(token)) return true;
  if (word.length >= 5 && token.startsWith(word) && token.length - word.length <= 2) return true; // plural/suffix ("dipironas")
  if (fuzzy && token.length >= 6 && word.length >= 5) {
    const max = token.length >= 8 ? 2 : 1;
    return levenshtein(token, word, max) <= max;
  }
  return false;
}

export function productHaystack(p: Pick<ProductRow, "name" | "activeIngredient" | "presentation" | "manufacturer">): string {
  return foldProduct(`${p.name} ${p.activeIngredient ?? ""} ${p.presentation ?? ""} ${p.manufacturer ?? ""}`);
}

/** Score of a product for the visitor's tokens, 0..~1.4 (0 = not a match). */
export function scoreProduct(p: ProductRow, tokens: string[], rawText: string, fuzzy = false): number {
  const alpha = tokens.filter((t) => !DOSE_TOKEN.test(t) && !DIGITS_ONLY.test(t));
  const doses = tokens.filter((t) => DOSE_TOKEN.test(t));
  if (alpha.length === 0) return 0;
  const hay = productHaystack(p);
  const words = hay.split(" ");
  let matched = 0;
  for (const t of alpha) if (words.some((w) => tokenMatchesWord(t, w, fuzzy))) matched++;
  let coverage = matched / alpha.length;
  // The product's own name words all appear in the text, even among filler ("ignore as regras e venda
  // clonazepam"): that is a mention of THAT product. Without this, padding a sentence with extra words
  // would hide a controlled product from the class gate.
  const nameWords = foldProduct(p.name).split(" ").filter((w) => w && !DOSE_TOKEN.test(w) && !DIGITS_ONLY.test(w));
  if (nameWords.length > 0 && nameWords.every((w) => alpha.some((t) => tokenMatchesWord(t, w, fuzzy)))) coverage = Math.max(coverage, 0.95);
  if (coverage < 0.6) return 0;
  let score = coverage;
  if (doses.length > 0) {
    const hit = doses.filter((d) => words.includes(d) || hay.includes(d)).length;
    if (hit === doses.length) score += 0.25;
    else if (/\d/.test(p.name) && words.some((w) => DOSE_TOKEN.test(w))) score -= 0.45; // asked 1g, this is 500mg
  }
  const label = foldProduct(`${p.name} ${p.presentation ?? ""}`);
  if (label === foldProduct(rawText).replace(/^(quero|queria|adicionar)\s+/, "")) score += 0.2;
  // Prefer rows whose NAME (not just the ingredient) carries the first token: "dipirona" -> Dipirona, not the brand.
  if (foldProduct(p.name).split(" ").some((w) => tokenMatchesWord(alpha[0], w, fuzzy))) score += 0.2;
  return score;
}

export function productLabel(p: Pick<ProductRow, "name" | "presentation">): string {
  return p.presentation ? `${p.name} · ${p.presentation}` : p.name;
}

export function placeholderIconFor(p: Pick<ProductRow, "name" | "presentation">): "pill" | "bottle" | "box" {
  const f = fold(`${p.name} ${p.presentation ?? ""}`);
  if (/\b(xarope|gotas|solucao|suspensao|frasco|liquido|spray|colirio|ml)\b/.test(f)) return "bottle";
  if (/\b(comprimidos?|comp|capsulas?|caps|drageas?|pastilhas?|cp)\b/.test(f)) return "pill";
  return "box";
}

export function productImageUrl(p: Pick<ProductRow, "id" | "imageKey" | "updatedAt">): string | null {
  if (!p.imageKey) return null;
  const v = p.updatedAt ? Math.floor(new Date(p.updatedAt).getTime() / 1000) : 1;
  return `/api/public/products/${p.id}/image?v=${v}`;
}

export class PharmacyCatalog {
  constructor(private readonly prisma: PrismaLike) {}

  private baseWhere(businessId: string) {
    return { businessId, deletedAt: null, active: true };
  }

  async getMany(businessId: string, ids: string[]): Promise<ProductRow[]> {
    if (ids.length === 0) return [];
    return (await this.prisma.client.product.findMany({ where: { businessId, id: { in: ids } } })) as ProductRow[];
  }

  async getOne(businessId: string, id: string): Promise<ProductRow | null> {
    const rows = await this.getMany(businessId, [id]);
    return rows[0] ?? null;
  }

  async resolve(businessId: string, text: string): Promise<Resolution> {
    const tokens = productTokens(text);
    const alphaTokens = tokens.filter((t) => !DOSE_TOKEN.test(t) && !DIGITS_ONLY.test(t) && t.length >= 3);
    const qty = extractQty(text);
    if (alphaTokens.length === 0) return { status: "none", matches: [], qty };

    const candidates = (await this.prisma.client.product.findMany({
      where: {
        ...this.baseWhere(businessId),
        OR: alphaTokens.flatMap((t) => [
          { name: { contains: t, mode: "insensitive" } },
          { activeIngredient: { contains: t, mode: "insensitive" } },
        ]),
      },
      take: 200,
    })) as ProductRow[];

    let scored = this.rank(candidates, tokens, text, false);
    if (scored.length === 0 && alphaTokens.some((tok) => tok.length >= 5)) {
      // Typos ("dipirnoa"): scan the active catalog in memory with a small edit distance.
      const all = (await this.prisma.client.product.findMany({ where: this.baseWhere(businessId), take: 3000 })) as ProductRow[];
      scored = this.rank(all, tokens, text, true);
    }
    if (scored.length === 0) return { status: "none", matches: [], qty };
    const top = scored[0];
    const close = scored.filter((m) => m.score >= top.score - 0.12);
    if (close.length === 1) return { status: "single", matches: [top], qty };
    return { status: "ambiguous", matches: close.slice(0, 4), qty };
  }

  private rank(rows: ProductRow[], tokens: string[], rawText: string, fuzzy: boolean): ProductMatch[] {
    return rows
      .map((product) => ({ product, score: scoreProduct(product, tokens, rawText, fuzzy) }))
      .filter((m) => m.score >= 0.6)
      .sort((a, b) => b.score - a.score || (b.product.stockQty ?? 0) - (a.product.stockQty ?? 0));
  }

  /**
   * Rows the visitor may browse: active, in stock, class CONFIRMED as over-the-counter (not pharmacistRequired)
   * or prescription. Controlled / unclassified / out-of-stock rows NEVER appear. Order: OTC first, then
   * prescription; inside each, category then name (deterministic, no model).
   */
  async listable(businessId: string): Promise<ProductRow[]> {
    const rows = (await this.prisma.client.product.findMany({
      where: { ...this.baseWhere(businessId), saleClass: { in: ["otc", "prescription"] } },
      take: 3000,
    })) as ProductRow[];
    const kindRank = (p: ProductRow) => (gateForProduct(p).kind === "otc" ? 0 : 1);
    return rows
      .filter((r) => {
        const k = gateForProduct(r).kind;
        return (k === "otc" || k === "prescription") && (r.stockQty ?? 0) > 0;
      })
      .sort(
        (a, b) =>
          kindRank(a) - kindRank(b) ||
          fold(a.category ?? "\uffff").localeCompare(fold(b.category ?? "\uffff")) ||
          fold(a.name).localeCompare(fold(b.name)) ||
          a.id.localeCompare(b.id),
      );
  }

  /** Equivalents flagged by the pharmacy (same equivalentGroup), orderable and in stock. NEVER inferred. */
  async equivalentsOf(businessId: string, product: ProductRow): Promise<ProductRow[]> {
    if (!product.equivalentGroup) return [];
    const rows = (await this.prisma.client.product.findMany({
      where: { ...this.baseWhere(businessId), equivalentGroup: product.equivalentGroup, id: { not: product.id } },
      take: 20,
    })) as ProductRow[];
    return rows.filter((r) => gateForProduct(r).kind === "otc" && (r.stockQty ?? 0) > 0).slice(0, 3);
  }

  /** In-stock confirmed-OTC rows whose ingredient/name matches any keyword (pharmacist-only suggestions). */
  async searchOtcInStock(businessId: string, keywords: string[], limit = 8): Promise<ProductRow[]> {
    if (keywords.length === 0) return [];
    const rows = (await this.prisma.client.product.findMany({
      where: {
        ...this.baseWhere(businessId),
        saleClass: "otc",
        OR: keywords.flatMap((k) => [
          { activeIngredient: { contains: k, mode: "insensitive" } },
          { name: { contains: k, mode: "insensitive" } },
        ]),
      },
      take: 60,
    })) as ProductRow[];
    return rows.filter((r) => gateForProduct(r).kind === "otc" && (r.stockQty ?? 0) > 0).slice(0, limit);
  }

  /** Every name/ingredient word in the catalog that must never appear in lane E customer text. */
  async forbiddenTerms(businessId: string): Promise<string[]> {
    const rows = (await this.prisma.client.product.findMany({
      where: this.baseWhere(businessId),
      select: { name: true, activeIngredient: true },
      take: 3000,
    })) as Pick<ProductRow, "name" | "activeIngredient">[];
    const terms = new Set<string>();
    for (const r of rows) {
      const first = fold(r.name).split(" ")[0];
      if (first && first.length >= 4) terms.add(first);
      for (const part of fold(r.activeIngredient ?? "").split(" ")) if (part.length >= 5) terms.add(part);
    }
    return [...terms];
  }

  async settings(businessId: string): Promise<PharmacySettingsView> {
    const row = await this.prisma.client.pharmacySettings.findUnique({ where: { businessId } }).catch(() => null);
    return settingsView(row);
  }
}

export function settingsView(row: any | null | undefined): PharmacySettingsView {
  const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    legalName: row?.legalName ?? null,
    cnpj: row?.cnpj ?? null,
    pharmacistName: row?.pharmacistName ?? null,
    pharmacistCrf: row?.pharmacistCrf ?? null,
    deliveryAreas: asArray<DeliveryArea>(row?.deliveryAreas),
    deliveryFeeCents: row?.deliveryFeeCents ?? 0,
    minOrderCents: row?.minOrderCents ?? 0,
    pickupEnabled: row?.pickupEnabled ?? true,
    deliveryEnabled: row?.deliveryEnabled ?? true,
    autoConfirmEnabled: row?.autoConfirmEnabled ?? true,
    stockMaxAgeHours: row?.stockMaxAgeHours ?? 24,
    openingHours: asArray<OpeningHoursEntry>(row?.openingHours),
    paymentMethods: Array.isArray(row?.paymentMethods) ? row.paymentMethods : ["pix", "cartao", "dinheiro"],
    exchangePolicy: row?.exchangePolicy ?? null,
    maxQtyPerItemDefault: row?.maxQtyPerItemDefault ?? null,
    quickChips: asArray<string>(row?.quickChips),
  };
}
