import { Injectable } from "@nestjs/common";
import type { Niche } from "@realwise/db";
import { PrismaService } from "../../prisma/prisma.service";
import {
  DEFAULT_REAL_ESTATE_MONTHLY_RATE_PERCENT,
  DEFAULT_VEHICLE_MONTHLY_RATE_PERCENT,
} from "./flow-calculators";

export type FinancingRateSource = "visitor" | "tenant" | "bcb" | "default";

export interface FinancingRateResult {
  monthlyRatePercent: number;
  rateSource: FinancingRateSource;
  /** Only set when rateSource === "bcb" — e.g. "09/2026", for labeling output distinctly from a tenant/visitor rate. */
  bcbReferenceMonth?: string;
}

function isPositiveFinite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function toDisplayMonth(referenceMonth: string): string {
  // referenceMonth is stored as "YYYY-MM" (see bcb-rate-sync.ts) — display as "MM/YYYY".
  const [year, month] = referenceMonth.split("-");
  return month && year ? `${month}/${year}` : referenceMonth;
}

// Precedence chain for the monthly financing rate used in simulator output, from most to least
// specific:
//   1. visitor-stated rate (extracted from free text by the simulator flow — Stage 3's job; this
//      service only accepts it as a param)
//   2. Business.financingRatePercent (tenant-configured override)
//   3. PlatformConfig BCB rate for the business's niche (platform-wide market reference)
//   4. DEFAULT_*_MONTHLY_RATE_PERCENT from flow-calculators.ts (hardcoded last-resort floor)
@Injectable()
export class FinancingRatesService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveRate(params: { businessId: string; niche: Niche; visitorStatedRatePercent?: number | null }): Promise<FinancingRateResult> {
    const { businessId, niche, visitorStatedRatePercent } = params;

    if (isPositiveFinite(visitorStatedRatePercent)) {
      return { monthlyRatePercent: visitorStatedRatePercent, rateSource: "visitor" };
    }

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { financingRatePercent: true },
    });
    if (isPositiveFinite(business?.financingRatePercent)) {
      return { monthlyRatePercent: business.financingRatePercent, rateSource: "tenant" };
    }

    const platformConfig = await this.prisma.client.platformConfig.findUnique({ where: { id: "singleton" } });
    const bcbRatePercent = (() => {
      switch (niche) {
        case "imobiliaria":
          return platformConfig?.realEstateRatePercent;
        case "concessionaria":
          return platformConfig?.vehicleRatePercent;
        case "farmacia":
          return null; // no financing for pharmacies (see niche-behavior.ts)
        default: {
          const _never: never = niche;
          return _never;
        }
      }
    })();
    if (isPositiveFinite(bcbRatePercent) && platformConfig?.ratesReferenceMonth) {
      return {
        monthlyRatePercent: bcbRatePercent,
        rateSource: "bcb",
        bcbReferenceMonth: toDisplayMonth(platformConfig.ratesReferenceMonth),
      };
    }

    const defaultRatePercent = (() => {
      switch (niche) {
        case "imobiliaria":
          return DEFAULT_REAL_ESTATE_MONTHLY_RATE_PERCENT;
        case "concessionaria":
          return DEFAULT_VEHICLE_MONTHLY_RATE_PERCENT;
        case "farmacia":
          return 0; // TODO(wave2:chat-engine): never reached, financing is disabled for pharmacies
        default: {
          const _never: never = niche;
          return _never;
        }
      }
    })();
    return { monthlyRatePercent: defaultRatePercent, rateSource: "default" };
  }
}

/**
 * Builds the caller-facing disclosure line for a resolved rate. Keep "bcb" visibly distinct from
 * a tenant/visitor-specific rate, per the plan: "taxa média de mercado (fonte: Banco Central,
 * MM/AAAA)" plus a reminder to confirm the real CET with the bank.
 */
export function describeFinancingRateSource(result: FinancingRateResult): string {
  switch (result.rateSource) {
    case "visitor":
      return "taxa informada por você";
    case "tenant":
      return "taxa praticada por esta empresa";
    case "bcb":
      return `taxa média de mercado (fonte: Banco Central, ${result.bcbReferenceMonth}) — confirme o CET real com o banco`;
    case "default":
      return "taxa estimada de referência — sujeito à aprovação e condições do banco";
  }
}
