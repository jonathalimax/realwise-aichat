// Selection memory: which listings the visitor explicitly selected in this conversation, and the
// deterministic answers built on top of that selection (total cost package, comparison, similar
// options, post-selection engagement). Dependency-free so it can be unit-tested directly.
//
// Grounding rule for everything here: every number shown comes from the listing's own stored
// fields/description or from an explicitly labelled percentage estimate (ITBI/cartório). Anything
// not present is listed as "não informado" — never guessed.

import type { Niche } from "@realwise/db";
import { normalizeText, formatCentsBRL } from "./triage";
import { nicheBehavior } from "./niche-behavior";

export const MAX_SELECTED_LISTINGS = 1;

// One listing at a time: selecting a listing replaces any earlier selection; deselecting clears it.
export function toggleSelection(current: readonly string[], listingId: string, selected: boolean): string[] {
  if (!selected) return current.filter((id) => id !== listingId);
  return [listingId];
}

export interface SelectedListingDetails {
  id: string;
  title: string;
  referenceCode?: string | null;
  transaction?: string | null;
  listingType?: string | null;
  priceCents?: number | null;
  pricePeriod?: string | null;
  priceText?: string | null;
  bedrooms?: number | null;
  parkingSpots?: number | null;
  areaM2?: number | null;
  neighborhood?: string | null;
  city?: string | null;
  description?: string | null;
}

export type TransactionKind = "rent" | "sale" | "unknown";

// What the listing is actually offered for. Only "sale" listings may get a purchase simulation
// (ITBI, cartório, financing) and only "rent" listings a monthly rental package. When the
// listing doesn't say, it is "unknown": we show its stated price and nothing else — never guess.
export function transactionKind(listing: Pick<SelectedListingDetails, "transaction" | "pricePeriod">): TransactionKind {
  const transaction = normalizeText(listing.transaction ?? "");
  const period = normalizeText(listing.pricePeriod ?? "");
  const rentSignal = /\b(alug\w*|loca\w*|rent\w*|temporada)\b/.test(transaction);
  const saleSignal = /\b(vend\w*|compr\w*|sale|sell\w*|buy)\b/.test(transaction);
  const monthly = /\b(mes|mensal|mensais|month\w*)\b/.test(period);
  if (rentSignal && !saleSignal) return "rent";
  if (saleSignal && !rentSignal) return "sale";
  // Both words, or neither: the price period is the tie-breaker; a monthly price is a rent.
  if (monthly) return "rent";
  if (rentSignal && saleSignal) return "sale";
  return "unknown";
}

export function isRental(listing: Pick<SelectedListingDetails, "transaction" | "pricePeriod">): boolean {
  return transactionKind(listing) === "rent";
}

export function isSale(listing: Pick<SelectedListingDetails, "transaction" | "pricePeriod">): boolean {
  return transactionKind(listing) === "sale";
}

export interface FeeMatch {
  cents: number;
  annual: boolean;
}

// Finds a fee stated in the listing's own description, e.g. "Condomínio: R$ 450", "IPTU R$ 1.200/ano".
export function extractFeeFromDescription(description: string | null | undefined, fee: "condominio" | "iptu"): FeeMatch | null {
  if (!description) return null;
  const label = fee === "condominio" ? "condom[ií]nio|cond\\." : "iptu";
  // The "R$" is mandatory ("condomínio fechado com 3 quartos" is not a R$ 3 fee), and the gap
  // between label and amount may not cross a sentence or another fee label: "Condomínio isento.
  // IPTU R$ 90" must NOT read as a R$ 90 condomínio.
  const pattern = new RegExp(`(?:${label})([^\\d\\n$.;]{0,25})R\\$\\s?(\\d{1,3}(?:\\.\\d{3})*(?:,\\d{1,2})?|\\d+(?:,\\d{1,2})?)\\s*(\\/\\s*ano|ao ano|anual|por ano)?`, "i");
  const match = description.match(pattern);
  if (!match) return null;
  const gap = normalizeText(match[1]);
  if (/\b(iptu|condominio|cond|isento|isenta|incluso|inclusa|incluido|consultar|consulte|sem)\b/.test(gap)) return null;
  const raw = match[2].replace(/\./g, "").replace(",", ".");
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { cents: Math.round(value * 100), annual: Boolean(match[3]) };
}

export interface CostLine {
  label: string;
  cents: number;
  estimated?: boolean;
  note?: string;
}

export interface CostPackage {
  listingId: string;
  title: string;
  kind: TransactionKind;
  lines: CostLine[];
  totalCents: number | null;
  totalLabel: string;
  monthlyAfterPurchase?: CostLine[];
  missing: string[];
}

export interface CostPackageOptions {
  itbiPercent: number;
  notaryPercent: number;
}

export function buildCostPackage(listing: SelectedListingDetails, options: CostPackageOptions): CostPackage {
  const condo = extractFeeFromDescription(listing.description, "condominio");
  const iptu = extractFeeFromDescription(listing.description, "iptu");
  const price = typeof listing.priceCents === "number" && listing.priceCents > 0 ? listing.priceCents : null;
  const missing: string[] = [];

  if (transactionKind(listing) === "unknown") {
    const lines: CostLine[] = price ? [{ label: "Valor do anúncio", cents: price }] : [];
    return { listingId: listing.id, title: listing.title, kind: "unknown", lines, totalCents: null, totalLabel: "", missing: price ? [] : ["valor"] };
  }

  const monthlyFees: CostLine[] = [];
  if (condo) monthlyFees.push({ label: "Condomínio", cents: condo.annual ? Math.round(condo.cents / 12) : condo.cents });
  else missing.push("condomínio");
  if (iptu) {
    monthlyFees.push({
      label: "IPTU",
      cents: iptu.annual ? Math.round(iptu.cents / 12) : iptu.cents,
      ...(iptu.annual ? { note: `${formatCentsBRL(iptu.cents)}/ano ÷ 12` } : {}),
    });
  } else missing.push("IPTU");

  if (isRental(listing)) {
    const lines: CostLine[] = [];
    if (price) lines.push({ label: "Aluguel", cents: price });
    else missing.unshift("valor do aluguel");
    lines.push(...monthlyFees);
    const totalCents = price ? lines.reduce((sum, l) => sum + l.cents, 0) : null;
    return { listingId: listing.id, title: listing.title, kind: "rent", lines, totalCents, totalLabel: "Total mensal", missing };
  }

  const lines: CostLine[] = [];
  let totalCents: number | null = null;
  if (price) {
    const itbi = Math.round((price * options.itbiPercent) / 100);
    const notary = Math.round((price * options.notaryPercent) / 100);
    lines.push(
      { label: "Valor do imóvel", cents: price },
      { label: `ITBI (estimativa ~${options.itbiPercent}%)`, cents: itbi, estimated: true },
      { label: `Escritura e registro (estimativa ~${options.notaryPercent}%)`, cents: notary, estimated: true },
    );
    totalCents = price + itbi + notary;
  } else {
    missing.unshift("valor de venda");
  }
  return {
    listingId: listing.id,
    title: listing.title,
    kind: "sale",
    lines,
    totalCents,
    totalLabel: "Total estimado na compra",
    monthlyAfterPurchase: monthlyFees,
    missing,
  };
}

export function formatCostPackage(pkg: CostPackage): string {
  const out: string[] = [`**${pkg.title}**`];
  for (const line of pkg.lines) {
    out.push(`- ${line.label}: ${formatCentsBRL(line.cents)}${line.note ? ` (${line.note})` : ""}`);
  }
  if (pkg.totalCents != null) {
    const partial = pkg.kind === "rent" && pkg.missing.length > 0 ? " (com os valores que tenho)" : "";
    out.push(`- **${pkg.totalLabel}${partial}: ${formatCentsBRL(pkg.totalCents)}**`);
  }
  if (pkg.kind === "sale" && pkg.monthlyAfterPurchase && pkg.monthlyAfterPurchase.length > 0) {
    out.push(`- Custos mensais depois da compra: ${pkg.monthlyAfterPurchase.map((l) => `${l.label} ${formatCentsBRL(l.cents)}`).join(" + ")}`);
  }
  if (pkg.missing.length > 0) {
    out.push(`- Não informado no anúncio: ${pkg.missing.join(", ")} — confirmo com o time pra você.`);
  }
  return out.join("\n");
}

export function buildCostPackageReply(packages: CostPackage[]): string {
  if (packages.length === 0) return "";
  const intro =
    packages.length === 1
      ? "Aqui está o pacote completo do imóvel que você selecionou 👇"
      : "Aqui está o pacote completo dos imóveis que você selecionou 👇";
  const hasSale = packages.some((p) => p.kind === "sale");
  const hasUnknown = packages.some((p) => p.kind === "unknown");
  const outro = hasSale
    ? "ITBI e cartório são estimativas pelas alíquotas usuais — o valor exato depende do município. Quer que eu simule o financiamento ou agende uma visita?"
    : hasUnknown
      ? "Esse anúncio não detalha as condições (aluguel ou venda, taxas) — confirmo com o time e te retorno. Quer agendar uma visita?"
      : "Quer que eu agende uma visita ou te mostre opções parecidas?";
  return [intro, ...packages.map(formatCostPackage), outro].join("\n\n");
}

const COST_QUESTION_PATTERNS = [
  /\btotal\b/,
  /\bpacote\b/,
  /\bquanto (fica|sai|custa|vou pagar|eu pagaria|eu pago|pago|da)\b/,
  /\bpagaria\b/,
  /\bcustos?\b/,
  /\bvalor (final|total|completo)\b/,
  /\btaxas?\b/,
  /\bcondominio\b.*\biptu\b|\biptu\b.*\bcondominio\b/,
];

// "Qual o pacote total que eu pagaria?", "quanto fica tudo por mês?", "quais os custos?".
// Financing questions are deliberately excluded — the financing simulator owns those.
export function isCostPackageQuestion(text: string): boolean {
  const normalized = normalizeText(text);
  if (/\b(financ|parcel|simul|entrada|fgts)\w*/.test(normalized)) return false;
  // "qual o total de quartos?" is about the listing's features, not money.
  if (/\btotal de (quartos|banheiros|vagas|suites|imoveis|comodos)\b/.test(normalized)) return false;
  return COST_QUESTION_PATTERNS.some((p) => p.test(normalized));
}

export function isSimilarRequest(text: string): boolean {
  const normalized = normalizeText(text);
  return /\b(parecid\w*|semelhante\w*|similar\w*|outras opcoes|outros imoveis|mais opcoes|outras parecidas)\b/.test(normalized);
}

export function isCompareRequest(text: string): boolean {
  const normalized = normalizeText(text);
  return /\b(compar\w*|diferenca entre|qual (e|eh) melhor|qual vale mais)\b/.test(normalized);
}

export interface SimilarCriteria {
  transaction?: string;
  listingType?: string;
  bedroomsMin?: number;
  bedroomsMax?: number;
  priceMin?: number;
  priceMax?: number;
  excludeIds: string[];
}

// "Opções parecidas": same transaction/type, ±1 bedroom, ±25% price.
export function similarListingCriteria(selected: SelectedListingDetails[]): SimilarCriteria | null {
  const anchor = selected[selected.length - 1];
  if (!anchor) return null;
  return {
    ...(anchor.transaction ? { transaction: anchor.transaction } : {}),
    ...(anchor.listingType ? { listingType: anchor.listingType } : {}),
    ...(typeof anchor.bedrooms === "number" ? { bedroomsMin: Math.max(0, anchor.bedrooms - 1), bedroomsMax: anchor.bedrooms + 1 } : {}),
    ...(typeof anchor.priceCents === "number" && anchor.priceCents > 0
      ? { priceMin: Math.round(anchor.priceCents * 0.75), priceMax: Math.round(anchor.priceCents * 1.25) }
      : {}),
    excludeIds: selected.map((s) => s.id),
  };
}

function shortFacts(listing: SelectedListingDetails): string {
  const facts: string[] = [];
  if (listing.listingType) facts.push(listing.listingType);
  const place = [listing.neighborhood, listing.city].filter(Boolean).join(", ");
  if (place) facts.push(place);
  if (typeof listing.bedrooms === "number") facts.push(`${listing.bedrooms} quarto${listing.bedrooms === 1 ? "" : "s"}`);
  if (typeof listing.areaM2 === "number") facts.push(`${listing.areaM2} m²`);
  if (typeof listing.parkingSpots === "number") facts.push(`${listing.parkingSpots} vaga${listing.parkingSpots === 1 ? "" : "s"}`);
  return facts.join(" · ");
}

export function buildComparisonReply(selected: SelectedListingDetails[], packages: CostPackage[]): string {
  const byId = new Map(packages.map((p) => [p.listingId, p]));
  const blocks = selected.map((listing) => {
    const pkg = byId.get(listing.id);
    const facts = shortFacts(listing);
    const total = pkg?.totalCents != null ? `${pkg.totalLabel}: ${formatCentsBRL(pkg.totalCents)}` : listing.priceText ?? "valor não informado";
    return [`**${listing.title}**`, facts ? `- ${facts}` : null, `- ${total}`].filter(Boolean).join("\n");
  });
  return ["Comparando os imóveis que você selecionou 👇", ...blocks, "Algum deles chamou mais sua atenção? Posso agendar uma visita ou buscar outros parecidos."].join("\n\n");
}

// Deterministic message right after a "Selecionar" tap: acknowledge, keep the visitor engaged
// with ONE light offer (not pushy), and hand quick-reply suggestions to the chat UI.
export function selectionEngagementReply(
  listing: SelectedListingDetails,
  _selectedCount: number,
  niche: Niche,
): { text: string; suggestions: string[] } {
  const noun = nicheBehavior(niche).selectionNoun;
  const kind = transactionKind(listing);
  const text =
    kind === "rent"
      ? `Ótima escolha! Separei **${listing.title}** pra você ✅ Quer que eu te passe o custo total por mês (aluguel + condomínio + IPTU) ou prefere já agendar uma visita?`
      : kind === "sale"
        ? `Ótima escolha! Separei **${listing.title}** pra você ✅ Posso te passar o custo total da compra, simular um financiamento ou agendar uma visita — o que prefere?`
        : `Ótima escolha! Separei **${listing.title}** pra você ✅ Posso te passar os detalhes, agendar uma visita ou mostrar opções parecidas — o que prefere?`;
  const suggestions: string[] = [];
  if (kind === "rent") suggestions.push("Quanto fica o total por mês?");
  else if (kind === "sale") suggestions.push("Quanto fica o custo total?");
  if (kind === "sale" && niche === "imobiliaria" && typeof listing.priceCents === "number" && listing.priceCents > 0) {
    suggestions.push(`Simular financiamento de ${formatCentsBRL(listing.priceCents)}`);
  }
  suggestions.push("Agendar uma visita");
  suggestions.push(`Ver ${noun === "imóvel" ? "imóveis" : "veículos"} parecidos`);
  return { text, suggestions: suggestions.slice(0, 4) };
}

function kindNote(kind: TransactionKind): string {
  if (kind === "rent") return "modalidade: SOMENTE ALUGUEL — não simule compra, ITBI nem financiamento";
  if (kind === "sale") return "modalidade: SOMENTE VENDA — não fale em aluguel mensal";
  return "modalidade não informada — não simule compra nem aluguel; confirme com o time";
}

// Injected into Clara's system prompt every turn while a selection exists.
export function selectionPromptBlock(selected: SelectedListingDetails[], packages: CostPackage[]): string {
  if (selected.length === 0) return "";
  const byId = new Map(packages.map((p) => [p.listingId, p]));
  const items = selected.map((listing, index) => {
    const pkg = byId.get(listing.id);
    const parts = [
      `${index + 1}. ${listing.title}`,
      listing.referenceCode ? `código ${listing.referenceCode}` : null,
      listing.transaction ? `(${listing.transaction})` : null,
      kindNote(transactionKind(listing)),
      shortFacts(listing) || null,
      listing.priceText ?? (typeof listing.priceCents === "number" ? formatCentsBRL(listing.priceCents) : null),
      pkg?.totalCents != null ? `${pkg.totalLabel}: ${formatCentsBRL(pkg.totalCents)}` : null,
      pkg && pkg.missing.length > 0 ? `não informado: ${pkg.missing.join(", ")}` : null,
      listing.description ? `descrição: ${listing.description.replace(/\s+/g, " ").slice(0, 400)}` : null,
    ].filter(Boolean);
    return parts.join(" — ");
  });
  return [
    "Imóvel/veículo que o cliente SELECIONOU nesta conversa (dados reais do cadastro — pode citar preço, quartos, área e os totais calculados abaixo):",
    ...items,
    "Perguntas sobre valor, custo total, 'pacote', visita, documentação ou 'esse imóvel' referem-se a esta seleção . NÃO mostre a lista de imóveis de novo nem pergunte qual imóvel ele escolheu — responda sobre a seleção. Nunca invente condomínio, IPTU ou taxas que não estejam acima; se faltar, diga que vai confirmar com o time.",
  ].join("\n");
}
