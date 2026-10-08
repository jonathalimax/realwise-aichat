import { Injectable } from "@nestjs/common";
import type { Niche } from "@realwise/db";
import { ListingsService, type ListingItem } from "../listings/listings.service";
import { FinancingRatesService, describeFinancingRateSource } from "./financing-rates.service";
import { calculateVehicleFinancing, formatBRL, simulateFinancing, type AmortizationSystem, type FinancingSimulationResult } from "./flow-calculators";

// Same disclaimer string flow.service.ts already uses verbatim for every simulator output —
// kept as a single literal here rather than exported/shared across modules, matching this
// codebase's existing per-module-constant convention (see chat.service.ts's own local constants).
const DISCLAIMER = "Taxa estimada, sujeito à aprovação.";

const DEFAULT_DOWN_PAYMENT_PERCENT = 20;

export interface SimulationBreakdown extends FinancingSimulationResult {}

export interface SimulationSuccess {
  kind: "result";
  breakdown: SimulationBreakdown;
  rateSource: string;
  rateSourceLabel: string;
  matchedListingIds: string[];
  matchedListings: ListingItem[];
  text: string;
}

export interface SimulationFollowUp {
  kind: "followup";
  text: string;
}

export type SimulationOutcome = SimulationSuccess | SimulationFollowUp;

// Simulate-verb vocabulary — requires one of these AND a parseable monetary amount in the same
// message before this is treated as financing-simulation intent (see detectsFinancingSimulationIntent).
const SIMULATE_VERB_PATTERN = /\bsimul\w*|\bfinanciar\b|\bfinanciamento\b|\bquanto fica\b|\bqual a parcela\b|\bparcela de\b/i;

// Document/policy questions ("quais documentos preciso", "qual a renda mínima exigida pelo
// banco") must fall through to the RAG/shared-knowledge path rather than being hijacked into the
// numeric simulator — UNLESS an explicit simulate-verb keyword ("simul*") is also present (e.g.
// "quero simular um financiamento de 400 mil, preciso de fiador?" IS a simulation + a document
// question at once, so the explicit simulate-keyword check below takes priority over this
// negative guard).
const DOCUMENT_POLICY_PATTERN = /\bdocumento\w*|\baprova[cç][aã]o\b|\brenda\s+m[ií]nima\b|\bbanco\b|\bcaixa\b|\bfiador\w*/i;

const MONEY_PATTERN =
  /r\$\s?[\d.,]+\s?(mil|k)?|\b\d+(?:[.,]\d+)?\s?(mil|k)\b|\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/i;

function hasMonetaryAmount(text: string): boolean {
  return MONEY_PATTERN.test(text);
}

export function detectsFinancingSimulationIntent(text: string, _niche: Niche): boolean {
  const normalized = text.toLowerCase();
  const hasVerb = SIMULATE_VERB_PATTERN.test(normalized);
  const hasMoney = hasMonetaryAmount(normalized);
  if (!hasVerb || !hasMoney) {
    return false;
  }
  const hasExplicitSimulateKeyword = /\bsimul\w*/.test(normalized);
  if (DOCUMENT_POLICY_PATTERN.test(normalized) && !hasExplicitSimulateKeyword) {
    return false;
  }
  return true;
}

// Parses a single pt-BR monetary expression into integer cents. Supports "R$ 400.000",
// "400.000,50", "400 mil", "400k". Returns null when nothing parseable is found.
export function parseMoneyToCents(raw: string): number | null {
  let text = raw.trim().toLowerCase();
  text = text.replace(/^r\$\s?/, "");

  let multiplier = 1;
  if (/\bmil\b/.test(text)) {
    multiplier = 1000;
    text = text.replace(/\bmil\b/, "").trim();
  } else if (/k$/.test(text)) {
    multiplier = 1000;
    text = text.replace(/k$/, "").trim();
  }

  // Disambiguate Brazilian "." (thousands) vs "," (decimal): if both present, "." is thousands
  // and "," is decimal. If only "." present and followed by exactly 3 digits groups, treat as
  // thousands separator (common "400.000"); otherwise treat as decimal.
  let normalized = text;
  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");
  if (hasComma && hasDot) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = normalized.replace(",", ".");
  } else if (hasDot) {
    // "400.000" (thousands) vs "400.5" (decimal) — a trailing group of exactly 3 digits after the
    // last dot means it's a thousands separator, not a decimal fraction.
    const parts = normalized.split(".");
    const last = parts[parts.length - 1];
    if (last.length === 3) {
      normalized = parts.join("");
    }
  }

  const value = parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * multiplier * 100);
}

// Finds the first standalone monetary expression in free text and returns its cents value.
function extractFirstMoneyCents(text: string): number | null {
  const match = text.match(/r\$\s?[\d.,]+\s?(?:mil|k)?|\b\d+(?:[.,]\d+)?\s?(?:mil|k)\b|\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/i);
  if (!match) return null;
  return parseMoneyToCents(match[0]);
}

function extractAllMoneyMatches(text: string): { raw: string; index: number; cents: number }[] {
  const pattern = /r\$\s?[\d.,]+\s?(?:mil|k)?|\b\d+(?:[.,]\d+)?\s?(?:mil|k)\b|\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/gi;
  const results: { raw: string; index: number; cents: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const cents = parseMoneyToCents(match[0]);
    if (cents != null) results.push({ raw: match[0], index: match.index, cents });
  }
  return results;
}

export interface ExtractedFinancingParams {
  valueCents?: number;
  downPaymentCents?: number;
  downPaymentPercent?: number;
  downPaymentIsPercent?: boolean;
  months?: number;
  annualRatePercent?: number;
  monthlyRatePercent?: number;
  system?: AmortizationSystem;
  systemDefaulted?: boolean;
}

// pt-BR free-text extraction: value (property/vehicle price), down payment (percent OR absolute,
// disambiguated by an adjacent "%" vs "de entrada"/"entrada de"), term ("anos"→months, or already
// stated in months/"x"), stated annual rate (converted to effective-monthly), and SAC/Price
// keyword detection.
export function extractFinancingParams(text: string): { params: ExtractedFinancingParams; missing: string[] } {
  const normalized = text.toLowerCase();
  const params: ExtractedFinancingParams = {};

  // Down payment: "20%" or "20% de entrada" -> percent; "R$ 80.000 de entrada"/"entrada de R$
  // 80.000" -> absolute cents. Checked before the generic "first money match" below so the
  // principal-value extraction doesn't accidentally grab the down-payment figure instead.
  const percentEntradaMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s?%\s*de\s*entrada|entrada\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s?%/);
  const RATE_UNIT_SUFFIX = /\s*(a\.?a\.?|a\.?m\.?|ao ano|ao mes|ao mês|anual|mensal)/i;
  const isRateUnitPercent =
    percentEntradaMatch != null &&
    RATE_UNIT_SUFFIX.test(normalized.slice(percentEntradaMatch.index! + percentEntradaMatch[0].length));
  if (percentEntradaMatch && !isRateUnitPercent) {
    const raw = percentEntradaMatch[1] ?? percentEntradaMatch[2];
    const percent = parseFloat(raw.replace(",", "."));
    if (Number.isFinite(percent) && percent >= 0 && percent < 100) {
      params.downPaymentPercent = percent;
      params.downPaymentIsPercent = true;
    }
  }
  if (!params.downPaymentIsPercent) {
    const absoluteEntradaMatch = normalized.match(
      /entrada\s*(?:de\s*)?(r\$\s?\d+(?:[.,]\d+)*\s?(?:mil|k)?|\d+(?:[.,]\d+)*\s?(?:mil|k)?)|(\d+(?:[.,]\d+)*\s?(?:mil|k)?)\s*(?:de\s*)?entrada/,
    );
    if (absoluteEntradaMatch) {
      const raw = absoluteEntradaMatch[1] ?? absoluteEntradaMatch[2];
      const cents = raw ? parseMoneyToCents(raw) : null;
      if (cents != null) {
        params.downPaymentCents = cents;
        params.downPaymentIsPercent = false;
      }
    }
  }

  // Property/vehicle value: the first monetary amount in the text that isn't the down-payment
  // figure already captured above.
  const allMoney = extractAllMoneyMatches(normalized);
  const downPaymentRaw = normalized.match(/entrada\s*(?:de\s*)?(r\$\s?[\d.,]+\s?(?:mil|k)?)|([\d.,]+\s?(?:mil|k)?)\s*(?:de\s*)?entrada/);
  const downPaymentIndex = downPaymentRaw?.index;
  const valueMatch = allMoney.find((m) => downPaymentIndex === undefined || m.index < downPaymentIndex || m.index > downPaymentIndex + (downPaymentRaw?.[0]?.length ?? 0));
  if (valueMatch) params.valueCents = valueMatch.cents;

  // Term: "X anos" -> months; "Xx"/"X meses" -> months directly.
  const anosMatch = normalized.match(/(\d+)\s*anos?/);
  const mesesMatch = normalized.match(/(\d+)\s*(?:meses|x\b)/);
  if (anosMatch) {
    params.months = parseInt(anosMatch[1], 10) * 12;
  } else if (mesesMatch) {
    params.months = parseInt(mesesMatch[1], 10);
  }

  // Visitor-stated annual rate -> effective-monthly conversion: i_m = (1+i_a)^(1/12) - 1.
  const annualRateMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s?%\s*(?:a\.?a\.?|ao ano|anual)/);
  const monthlyRateMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s?%\s*(?:a\.?m\.?|ao mes|ao mês|mensal)/);
  if (monthlyRateMatch) {
    params.monthlyRatePercent = parseFloat(monthlyRateMatch[1].replace(",", "."));
  } else if (annualRateMatch) {
    const annualPercent = parseFloat(annualRateMatch[1].replace(",", "."));
    if (Number.isFinite(annualPercent)) {
      params.annualRatePercent = annualPercent;
      const i_a = annualPercent / 100;
      const i_m = Math.pow(1 + i_a, 1 / 12) - 1;
      params.monthlyRatePercent = i_m * 100;
    }
  }

  // SAC/Price keyword detection — defaults to SAC for real estate (stated explicitly by the
  // caller when this default is actually applied, via systemDefaulted below).
  if (/\bprice\b/.test(normalized)) {
    params.system = "price";
  } else if (/\bsac\b/.test(normalized)) {
    params.system = "sac";
  } else {
    params.systemDefaulted = true;
  }

  const missing: string[] = [];
  if (params.valueCents == null) missing.push("value");
  if (params.months == null) missing.push("months");

  return { params, missing };
}

export interface ValidatedFinancingParams {
  valueCents: number;
  downPaymentCents: number;
  downPaymentPercentUsed: number;
  downPaymentDefaulted: boolean;
  months: number;
  system: AmortizationSystem;
  systemDefaulted: boolean;
  visitorStatedMonthlyRatePercent?: number;
}

// Required: value + months (value asked first since it's needed to resolve an absolute down
// payment anyway). Only ever asks for ONE missing param at a time. Entrada defaults silently to
// 20% when unstated (the default is surfaced in the eventual output line, not asked as a
// question). Rate/system are always defaulted silently — never asked.
export function validateFinancingParams(params: ExtractedFinancingParams, niche: Niche): string | ValidatedFinancingParams {
  if (params.valueCents == null) {
    return niche === "imobiliaria"
      ? "Qual o valor do imóvel que você quer simular?"
      : "Qual o valor do veículo que você quer simular?";
  }
  if (params.months == null) {
    return "Em quantos meses (ou anos) você quer simular o financiamento?";
  }

  let downPaymentCents: number;
  let downPaymentPercentUsed: number;
  let downPaymentDefaulted = false;
  if (params.downPaymentIsPercent && params.downPaymentPercent != null) {
    downPaymentPercentUsed = params.downPaymentPercent;
    downPaymentCents = Math.round(params.valueCents * (params.downPaymentPercent / 100));
  } else if (!params.downPaymentIsPercent && params.downPaymentCents != null) {
    downPaymentCents = params.downPaymentCents;
    downPaymentPercentUsed = (downPaymentCents / params.valueCents) * 100;
  } else {
    downPaymentDefaulted = true;
    downPaymentPercentUsed = DEFAULT_DOWN_PAYMENT_PERCENT;
    downPaymentCents = Math.round(params.valueCents * (DEFAULT_DOWN_PAYMENT_PERCENT / 100));
  }

  return {
    valueCents: params.valueCents,
    downPaymentCents,
    downPaymentPercentUsed,
    downPaymentDefaulted,
    months: params.months,
    system: params.system ?? "sac",
    systemDefaulted: params.systemDefaulted ?? params.system == null,
    visitorStatedMonthlyRatePercent: params.monthlyRatePercent,
  };
}

@Injectable()
export class SimulatorService {
  constructor(
    private readonly listingsService: ListingsService,
    private readonly financingRates: FinancingRatesService,
  ) {}

  async simulate(businessId: string, niche: Niche, visitorText: string): Promise<SimulationOutcome> {
    const { params } = extractFinancingParams(visitorText);
    const validatedOrQuestion = validateFinancingParams(params, niche);

    if (typeof validatedOrQuestion === "string") {
      return { kind: "followup", text: validatedOrQuestion };
    }

    const validated = validatedOrQuestion;

    const rate = await this.financingRates.resolveRate({
      businessId,
      niche,
      visitorStatedRatePercent: validated.visitorStatedMonthlyRatePercent,
    });
    const rateSourceLabel = describeFinancingRateSource(rate);

    const entradaNote = validated.downPaymentDefaulted
      ? ` (entrada padrão de ${DEFAULT_DOWN_PAYMENT_PERCENT}% aplicada, por não ter sido informada)`
      : "";
    const systemNote = validated.systemDefaulted ? " (sistema SAC aplicado por padrão)" : "";

    if (niche === "concessionaria") {
      const result = calculateVehicleFinancing({
        priceCents: validated.valueCents,
        downPaymentCents: validated.downPaymentCents,
        months: validated.months,
        monthlyRatePercent: rate.monthlyRatePercent,
      });
      if (!result) {
        return {
          kind: "followup",
          text: `Não consegui simular com esses valores — a entrada informada é maior ou igual ao valor do veículo, ou o prazo é inválido. Pode confirmar os valores? ${DISCLAIMER}`,
        };
      }

      const affordableCeilingCents = validated.valueCents;
      const matchedListings = await this.listingsService.queryForChat(
        businessId,
        { transaction: "venda", priceMax: affordableCeilingCents, ordem: "km_asc" },
        3,
      );
      const matchedListingIds = matchedListings.map((l) => l.id).filter((id): id is string => Boolean(id));

      // Reuse simulateFinancing's shape for the output card even for the vehicle (Price-style)
      // path, so SimulationCard.tsx has one consistent shape to render regardless of niche.
      const breakdown: SimulationBreakdown = {
        principalCents: result.principalCents,
        downPaymentCents: validated.downPaymentCents,
        downPaymentPercent: (validated.downPaymentCents / validated.valueCents) * 100,
        months: validated.months,
        monthlyRatePercent: rate.monthlyRatePercent,
        system: "price",
        firstInstallmentCents: result.monthlyPaymentCents,
        lastInstallmentCents: result.monthlyPaymentCents,
        averageInstallmentCents: result.monthlyPaymentCents,
        totalPaidCents: result.totalPaidCents,
        totalInterestCents: result.totalInterestCents,
      };

      const text = `Simulação: parcela de ~${formatBRL(result.monthlyPaymentCents)} em ${validated.months}x (${rateSourceLabel}, ${rate.monthlyRatePercent.toFixed(2)}% a.m.)${entradaNote}. Total financiado de ${formatBRL(result.principalCents)}, total pago ao final de ~${formatBRL(result.totalPaidCents)}. ${DISCLAIMER}`;

      return {
        kind: "result",
        breakdown,
        rateSource: rate.rateSource,
        rateSourceLabel,
        matchedListingIds,
        matchedListings,
        text,
      };
    }

    // imobiliaria (real estate) — SAC default per the plan.
    const result = simulateFinancing({
      propertyPriceCents: validated.valueCents,
      downPaymentCents: validated.downPaymentCents,
      months: validated.months,
      monthlyRatePercent: rate.monthlyRatePercent,
      system: validated.system,
    });
    if (!result) {
      return {
        kind: "followup",
        text: `Não consegui simular com esses valores — a entrada informada é maior ou igual ao valor do imóvel, ou o prazo é inválido. Pode confirmar os valores? ${DISCLAIMER}`,
      };
    }

    const affordableCeilingCents = validated.valueCents;
    const matchedListings = await this.listingsService.queryForChat(
      businessId,
      { transaction: "venda", priceMax: affordableCeilingCents },
      3,
    );
    const matchedListingIds = matchedListings.map((l) => l.id).filter((id): id is string => Boolean(id));

    const lastInstallmentNote =
      result.system === "sac" ? `, última parcela de ~${formatBRL(result.lastInstallmentCents)}` : "";
    const text = `Simulação (${result.system.toUpperCase()}${systemNote}): 1ª parcela de ~${formatBRL(result.firstInstallmentCents)}${lastInstallmentNote} em ${validated.months}x (${rateSourceLabel}, ${rate.monthlyRatePercent.toFixed(2)}% a.m.)${entradaNote}. Total financiado de ${formatBRL(result.principalCents)}, total pago ao final de ~${formatBRL(result.totalPaidCents)}, juros totais de ~${formatBRL(result.totalInterestCents)}. ${DISCLAIMER}`;

    return {
      kind: "result",
      breakdown: result,
      rateSource: rate.rateSource,
      rateSourceLabel,
      matchedListingIds,
      matchedListings,
      text,
    };
  }
}
