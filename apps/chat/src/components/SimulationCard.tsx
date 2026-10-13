"use client";

import { ListingCards } from "./ChatScreen";
import type { Listing } from "./ListingDetailOverlay";

// Local duplicate of the API's flow-calculators.ts formatBRL — same cents->BRL convention, kept
// per-package rather than shared across apps, matching this codebase's existing per-module
// constant/helper duplication pattern (see chat.service.ts's own local `normalize`).
function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export interface SimulationBreakdown {
  principalCents: number;
  downPaymentCents: number;
  downPaymentPercent: number;
  months: number;
  monthlyRatePercent: number;
  system: "sac" | "price";
  firstInstallmentCents: number;
  lastInstallmentCents: number;
  averageInstallmentCents: number;
  totalPaidCents: number;
  totalInterestCents: number;
}

export interface SimulationData {
  breakdown: SimulationBreakdown;
  rateSource: string;
  rateSourceLabel: string;
  matchedListingIds: string[];
}

const DISCLAIMER = "Taxa estimada, sujeito à aprovação.";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-xs text-ink-soft">{label}</span>
      <span className="text-sm font-medium text-ink">{value}</span>
    </div>
  );
}


// Exhaustive per niche (no silent real-estate fallback). Pharmacies never show financing simulations.
function matchedListingsTitle(niche?: string | null): string {
  switch (niche) {
    case "concessionaria":
      return "Veículos que cabem no seu orçamento";
    case "imobiliaria":
      return "Imóveis que cabem no seu orçamento";
    case "farmacia":
    default:
      return "Itens que cabem no seu orçamento";
  }
}

export function SimulationCard({
  data,
  listings,
  niche,
  onOpenListing,
  onSelectListing,
  selectedIds,
}: {
  data: SimulationData;
  listings?: Listing[];
  niche?: string;
  onOpenListing: (listing: Listing) => void;
  onSelectListing?: (listing: Listing) => void;
  selectedIds?: ReadonlySet<string>;
}) {
  const { breakdown } = data;
  const isSac = breakdown.system === "sac";

  return (
    <div className="glass-card mt-2 rounded-card p-4">
      <div className="mb-2 text-sm font-semibold text-ink">Simulação de financiamento</div>
      <Row label="Valor" value={formatBRL(breakdown.principalCents + breakdown.downPaymentCents)} />
      <Row
        label="Entrada"
        value={`${formatBRL(breakdown.downPaymentCents)} (${breakdown.downPaymentPercent.toFixed(0)}%)`}
      />
      <Row label="Prazo" value={`${breakdown.months}x`} />
      <Row label="Sistema" value={breakdown.system.toUpperCase()} />
      {isSac ? (
        <>
          <Row label="1ª parcela" value={`~${formatBRL(breakdown.firstInstallmentCents)}`} />
          <Row label="Última parcela" value={`~${formatBRL(breakdown.lastInstallmentCents)}`} />
        </>
      ) : (
        <Row label="Parcela fixa" value={`~${formatBRL(breakdown.firstInstallmentCents)}`} />
      )}
      <Row label="Total de juros" value={`~${formatBRL(breakdown.totalInterestCents)}`} />
      <Row label="Total pago" value={`~${formatBRL(breakdown.totalPaidCents)}`} />

      <div className="mt-2 border-t border-border pt-2 text-xs text-ink-soft">
        {data.rateSourceLabel}
        <br />
        {DISCLAIMER}
      </div>

      {listings && listings.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-ink">
            {matchedListingsTitle(niche)}
          </div>
          <ListingCards listings={listings} onOpen={onOpenListing} onSelect={onSelectListing} selectedIds={selectedIds} />
        </div>
      )}
    </div>
  );
}
