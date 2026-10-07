import { prisma } from "@realwise/db";

// BCB SGS (Sistema Gerenciador de Séries Temporais) series — confirmed against
// https://dadosabertos.bcb.gov.br (package_search) and cross-checked by calling the live API
// and comparing the monthly vs. annual series for internal consistency:
//   - 25497 "Taxa média mensal de juros ... recursos direcionados - Pessoas físicas -
//     Financiamento imobiliário com taxas de mercado - Percentual ao mês" (sample: 1.12% a.m.,
//     consistent with series 20772's 14.24% a.a. equivalent).
//   - 25471 "Taxa média mensal de juros ... recursos livres - Pessoas físicas - Aquisição de
//     veículos - Percentual ao mês" (sample: 1.97% a.m., consistent with series 20749's 26.42%
//     a.a. equivalent).
// Both are "% ao mês" so they drop in directly next to DEFAULT_*_MONTHLY_RATE_PERCENT /
// Business.financingRatePercent without any annual<->monthly conversion.
const REAL_ESTATE_SERIES_ID = 25497;
const VEHICLE_SERIES_ID = 25471;

const SGS_URL = (seriesId: number) =>
  `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${seriesId}/dados/ultimos/1?formato=json`;

interface SgsDatum {
  data: string; // "DD/MM/YYYY"
  valor: string;
}

async function fetchLatest(seriesId: number): Promise<{ ratePercent: number; referenceMonth: string } | null> {
  const res = await fetch(SGS_URL(seriesId));
  if (!res.ok) {
    console.error(`[bcb-rate-sync] series ${seriesId}: HTTP ${res.status}`);
    return null;
  }
  const body = (await res.json()) as SgsDatum[];
  const datum = body[0];
  if (!datum) {
    console.error(`[bcb-rate-sync] series ${seriesId}: empty response`);
    return null;
  }
  const ratePercent = Number(datum.valor.replace(",", "."));
  if (!Number.isFinite(ratePercent) || ratePercent <= 0) {
    console.error(`[bcb-rate-sync] series ${seriesId}: unparseable valor "${datum.valor}"`);
    return null;
  }
  const [, month, year] = datum.data.split("/");
  if (!month || !year) {
    console.error(`[bcb-rate-sync] series ${seriesId}: unparseable data "${datum.data}"`);
    return null;
  }
  return { ratePercent, referenceMonth: `${year}-${month}` };
}

export async function processBcbRateSync() {
  const [realEstate, vehicle] = await Promise.all([
    fetchLatest(REAL_ESTATE_SERIES_ID),
    fetchLatest(VEHICLE_SERIES_ID),
  ]);

  if (!realEstate && !vehicle) {
    console.error("[bcb-rate-sync] both series failed to fetch — leaving PlatformConfig untouched, flow-calculators.ts defaults still apply");
    return;
  }

  // BCB publishes these series monthly (usually with a ~1 month lag), so weekly polls between
  // releases will keep returning the same reference month — dedupe on that to avoid pointless
  // writes and noisy logs.
  const referenceMonth = (realEstate ?? vehicle)!.referenceMonth;

  const existing = await prisma.platformConfig.findUnique({ where: { id: "singleton" } });
  if (existing?.ratesReferenceMonth === referenceMonth) {
    console.log(`[bcb-rate-sync] no-op — reference month ${referenceMonth} already stored`);
    return;
  }

  await prisma.platformConfig.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      realEstateRatePercent: realEstate?.ratePercent ?? existing?.realEstateRatePercent ?? null,
      vehicleRatePercent: vehicle?.ratePercent ?? existing?.vehicleRatePercent ?? null,
      ratesReferenceMonth: referenceMonth,
      ratesFetchedAt: new Date(),
    },
    update: {
      realEstateRatePercent: realEstate?.ratePercent ?? existing?.realEstateRatePercent ?? null,
      vehicleRatePercent: vehicle?.ratePercent ?? existing?.vehicleRatePercent ?? null,
      ratesReferenceMonth: referenceMonth,
      ratesFetchedAt: new Date(),
    },
  });

  console.log(
    `[bcb-rate-sync] wrote new rates for reference month ${referenceMonth} — real estate: ${realEstate?.ratePercent ?? "unchanged"}% a.m., vehicle: ${vehicle?.ratePercent ?? "unchanged"}% a.m.`,
  );
}
