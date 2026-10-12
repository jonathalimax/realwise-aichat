// Deterministic replacements for the financing/cost "simulation" flow nodes that used to fall
// through to the generic LLM-prose fallback in flow.service.ts — that path is slow (5-30s,
// sometimes a 60s timeout) AND, worse, invents plausible-looking numbers with no real grounding.
// Every function here is a pure calculator: given the real params the flow has actually captured,
// it either returns a concrete result or `null` when a required input is missing/invalid — it
// never guesses, divides by zero, or produces NaN/Infinity.
//
// All rates below are illustrative defaults, not a real credit offer — every caller-facing message
// built from these results must carry an explicit "taxa estimada, sujeito à aprovação" disclaimer.
// Businesses can configure their own monthly rate via `Business.financingRatePercent` — these
// constants are only the fallback used when that field is null.

export const DEFAULT_VEHICLE_MONTHLY_RATE_PERCENT = 1.8;
export const DEFAULT_REAL_ESTATE_MONTHLY_RATE_PERCENT = 0.9;
export const DEFAULT_MAX_PAYMENT_TO_INCOME_RATIO = 0.3; // standard Brazilian bank affordability rule of thumb
export const DEFAULT_SEGURO_FIANCA_ANNUAL_RATIO = 1.2; // ~1.2x one month's rent per year of coverage, paid monthly
export const DEFAULT_RENTAL_EXTRA_COSTS_RATIO = 0.12; // condomínio + IPTU rough estimate on top of rent
export const DEFAULT_ITBI_PERCENT = 3; // typical municipal ITBI rate range in Brazil (2-4%)
export const DEFAULT_NOTARY_PERCENT = 1.5; // escritura + registro, typical combined range (1-2%)
export const DEFAULT_LATE_PAYMENT_FINE_PERCENT = 2; // typical contractual mora fine on the overdue amount
export const DEFAULT_LATE_PAYMENT_INTEREST_PERCENT = 1; // typical contractual mora interest, per month

/** Formats integer cents as Brazilian Real text, e.g. 123456 -> "R$ 1.234,56". */
export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function isPositiveFinite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function isNonNegativeFinite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/** Standard amortized-loan installment: PMT = P * i / (1 - (1+i)^-n). */
function pmtCents(principalCents: number, monthlyRatePercent: number, months: number): number | null {
  if (!isPositiveFinite(principalCents) || !isPositiveFinite(months) || !Number.isInteger(months)) return null;
  if (!isPositiveFinite(monthlyRatePercent)) return null;
  const i = monthlyRatePercent / 100;
  const denominator = 1 - (1 + i) ** -months;
  if (denominator <= 0) return null;
  return principalCents * (i / denominator);
}

/** Inverse of pmtCents: max principal supportable by a given installment. */
function maxPrincipalForPaymentCents(paymentCents: number, monthlyRatePercent: number, months: number): number | null {
  if (!isPositiveFinite(paymentCents) || !isPositiveFinite(months) || !Number.isInteger(months)) return null;
  if (!isPositiveFinite(monthlyRatePercent)) return null;
  const i = monthlyRatePercent / 100;
  const denominator = 1 - (1 + i) ** -months;
  if (denominator <= 0) return null;
  return paymentCents * (denominator / i);
}

export interface VehicleFinancingResult {
  monthlyPaymentCents: number;
  /** Total cash outlay: down payment + all installments. */
  totalPaidCents: number;
  totalInterestCents: number;
  principalCents: number;
}

/**
 * fin_res (concessionaria): standard amortization given a known vehicle price.
 * Returns null when the price/entrada/months combination is missing or invalid (e.g. entrada
 * at or above the vehicle price, or a non-positive term).
 */
export function calculateVehicleFinancing(input: {
  priceCents: number;
  downPaymentCents: number;
  months: number;
  monthlyRatePercent?: number;
}): VehicleFinancingResult | null {
  const { priceCents, downPaymentCents, months } = input;
  const rate = input.monthlyRatePercent ?? DEFAULT_VEHICLE_MONTHLY_RATE_PERCENT;
  if (!isPositiveFinite(priceCents) || !isNonNegativeFinite(downPaymentCents)) return null;
  if (downPaymentCents >= priceCents) return null;
  const principalCents = priceCents - downPaymentCents;
  const monthlyPaymentCents = pmtCents(principalCents, rate, months);
  if (monthlyPaymentCents == null) return null;
  const totalPaidCents = monthlyPaymentCents * months + downPaymentCents;
  return {
    monthlyPaymentCents,
    totalPaidCents,
    totalInterestCents: totalPaidCents - priceCents,
    principalCents,
  };
}

export interface VehicleAffordabilityResult {
  maxPriceCents: number;
  principalCents: number;
}

/**
 * fin_res fallback path: when no specific vehicle price is bound yet but the visitor already
 * picked a target monthly-payment budget (fin_parcela's `parcela` param), estimate the price range
 * that budget supports instead of asking the visitor to repeat themselves.
 */
export function calculateVehicleAffordablePrice(input: {
  targetMonthlyPaymentCents: number;
  downPaymentCents: number;
  months: number;
  monthlyRatePercent?: number;
}): VehicleAffordabilityResult | null {
  const { targetMonthlyPaymentCents, downPaymentCents, months } = input;
  const rate = input.monthlyRatePercent ?? DEFAULT_VEHICLE_MONTHLY_RATE_PERCENT;
  if (!isPositiveFinite(targetMonthlyPaymentCents) || !isNonNegativeFinite(downPaymentCents)) return null;
  const principalCents = maxPrincipalForPaymentCents(targetMonthlyPaymentCents, rate, months);
  if (principalCents == null) return null;
  return { maxPriceCents: principalCents + downPaymentCents, principalCents };
}

export interface RealEstateFinancingResult {
  maxPropertyPriceCents: number;
  monthlyPaymentCents: number;
  loanCents: number;
  downPaymentCents: number;
}

/**
 * cp_sim_res (imobiliaria): standard bank affordability rule — max installment is a fixed share of
 * monthly income, then invert the amortization formula for that installment over the chosen term,
 * then gross up by the chosen down-payment percentage to get the max property price.
 * Returns null when income/years/downPaymentPercent are missing or make the loan unsolvable
 * (e.g. downPaymentPercent >= 100).
 */
export function calculateRealEstateFinancing(input: {
  monthlyIncomeCents: number;
  downPaymentPercent: number;
  years: number;
  monthlyRatePercent?: number;
  maxPaymentToIncomeRatio?: number;
}): RealEstateFinancingResult | null {
  const { monthlyIncomeCents, downPaymentPercent, years } = input;
  const rate = input.monthlyRatePercent ?? DEFAULT_REAL_ESTATE_MONTHLY_RATE_PERCENT;
  const ratio = input.maxPaymentToIncomeRatio ?? DEFAULT_MAX_PAYMENT_TO_INCOME_RATIO;
  if (!isPositiveFinite(monthlyIncomeCents) || !isPositiveFinite(years)) return null;
  if (!isNonNegativeFinite(downPaymentPercent) || downPaymentPercent >= 100) return null;
  const months = Math.round(years * 12);
  const monthlyPaymentCents = monthlyIncomeCents * ratio;
  const loanCents = maxPrincipalForPaymentCents(monthlyPaymentCents, rate, months);
  if (loanCents == null) return null;
  const maxPropertyPriceCents = loanCents / (1 - downPaymentPercent / 100);
  return {
    maxPropertyPriceCents,
    monthlyPaymentCents,
    loanCents,
    downPaymentCents: maxPropertyPriceCents - loanCents,
  };
}

export type AmortizationSystem = "sac" | "price";

export interface FinancingSimulationResult {
  principalCents: number;
  downPaymentCents: number;
  downPaymentPercent: number;
  months: number;
  monthlyRatePercent: number;
  system: AmortizationSystem;
  firstInstallmentCents: number;
  lastInstallmentCents: number;
  averageInstallmentCents: number;
  /** Total cash outlay: down payment + all installments (matches VehicleFinancingResult's semantics). */
  totalPaidCents: number;
  totalInterestCents: number;
}

/**
 * Pure amortization simulator supporting both Brazilian systems: SAC (Sistema de Amortização
 * Constante — constant amortization, declining installments, the Brazilian real-estate default)
 * and Price (constant installment, already used elsewhere in this file via pmtCents). This is a
 * standalone building block for a later simulator stage — not wired into any flow/chat orchestration
 * yet. Returns null when the price/down-payment/term/rate combination is missing or invalid.
 */
export function simulateFinancing(input: {
  propertyPriceCents: number;
  downPaymentCents: number;
  months: number;
  monthlyRatePercent: number;
  system: AmortizationSystem;
}): FinancingSimulationResult | null {
  const { propertyPriceCents, downPaymentCents, months, monthlyRatePercent, system } = input;
  if (!isPositiveFinite(propertyPriceCents)) return null;
  if (!isNonNegativeFinite(downPaymentCents) || downPaymentCents >= propertyPriceCents) return null;
  if (!Number.isInteger(months) || months <= 0) return null;
  if (!isPositiveFinite(monthlyRatePercent)) return null;

  const principalCents = propertyPriceCents - downPaymentCents;
  const i = monthlyRatePercent / 100;

  let firstInstallmentCents: number;
  let lastInstallmentCents: number;
  let totalInterestCents: number;

  if (system === "price") {
    const installmentCents = pmtCents(principalCents, monthlyRatePercent, months);
    if (installmentCents == null) return null;
    firstInstallmentCents = installmentCents;
    lastInstallmentCents = installmentCents;
    totalInterestCents = installmentCents * months - principalCents;
  } else {
    // SAC: constant amortization each month, interest declines linearly on the outstanding balance.
    const amortizationCents = principalCents / months;
    firstInstallmentCents = amortizationCents + principalCents * i;
    lastInstallmentCents = amortizationCents * (1 + i);
    // Closed-form sum of the declining-balance interest series — O(1), no per-installment loop.
    totalInterestCents = principalCents * i * ((months + 1) / 2);
  }

  // Total cash outlay the consumer actually pays: principal + interest + the down payment itself
  // (matches VehicleFinancingResult's totalPaidCents semantics — see interface doc comment above).
  const totalPaidCents = principalCents + totalInterestCents + downPaymentCents;
  const averageInstallmentCents = (principalCents + totalInterestCents) / months;

  return {
    principalCents: Math.round(principalCents),
    downPaymentCents: Math.round(downPaymentCents),
    downPaymentPercent: (downPaymentCents / propertyPriceCents) * 100,
    months,
    monthlyRatePercent,
    system,
    firstInstallmentCents: Math.round(firstInstallmentCents),
    lastInstallmentCents: Math.round(lastInstallmentCents),
    averageInstallmentCents: Math.round(averageInstallmentCents),
    totalPaidCents: Math.round(totalPaidCents),
    totalInterestCents: Math.round(totalInterestCents),
  };
}

export interface RentalCostResult {
  monthlyRentCents: number;
  totalMonthlyCostCents: number;
  extraCostsCents: number;
}

/**
 * al_simular_res (imobiliaria): the visitor only ever gives a price *bucket* (`faixa`), never a
 * raw rent value, so this works off the bucket's midpoint — same bucket boundaries flow.service's
 * own faixaToPriceRange already uses for filtering listings, kept as the single source of truth
 * for that mapping. Returns null when no usable rent midpoint can be derived.
 */
export function calculateRentalTotalCost(input: {
  monthlyRentCents: number;
  extraCostsRatio?: number;
}): RentalCostResult | null {
  const { monthlyRentCents } = input;
  const ratio = input.extraCostsRatio ?? DEFAULT_RENTAL_EXTRA_COSTS_RATIO;
  if (!isPositiveFinite(monthlyRentCents)) return null;
  const extraCostsCents = monthlyRentCents * ratio;
  return { monthlyRentCents, totalMonthlyCostCents: monthlyRentCents + extraCostsCents, extraCostsCents };
}

export interface RentalInsuranceResult {
  monthlyInstallmentCents: number;
  annualPremiumCents: number;
}

/**
 * gar_simular (imobiliaria): seguro-fiança (rental-guarantee insurance), NOT seguro-incêndio —
 * priced here as a fraction of the actual monthly rent, paid in monthly installments across the
 * coverage year. Returns null when no rent value is available.
 */
export function calculateRentalInsurance(input: {
  monthlyRentCents: number;
  annualPremiumRatio?: number;
}): RentalInsuranceResult | null {
  const { monthlyRentCents } = input;
  const ratio = input.annualPremiumRatio ?? DEFAULT_SEGURO_FIANCA_ANNUAL_RATIO;
  if (!isPositiveFinite(monthlyRentCents)) return null;
  const annualPremiumCents = monthlyRentCents * ratio;
  return { monthlyInstallmentCents: annualPremiumCents / 12, annualPremiumCents };
}
