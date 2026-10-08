"use client";

import { useEffect, useState } from "react";
import { getTenantListings } from "../../lib/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../ui/table";

const PAGE_SIZE = 50;

function formatPrice(listing: any) {
  // priceCents is the normalized source of truth (always numeric, always cents) — prefer it over
  // priceText, which is whatever raw string the source site happened to use (plain "650000.00",
  // Brazilian "1770,00", etc.) and renders inconsistently in this table when shown verbatim.
  if (typeof listing.priceCents === "number") {
    return `R$ ${(listing.priceCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}${
      listing.pricePeriod ? ` / ${listing.pricePeriod}` : ""
    }`;
  }
  if (listing.priceText) return listing.priceText;
  return "—";
}

function formatLocation(listing: any) {
  return [listing.neighborhood, listing.city, listing.state].filter(Boolean).join(", ") || "—";
}

function extraFields(listing: any) {
  const entries: [string, string][] = [];
  if (listing.bedrooms != null) entries.push(["Quartos", String(listing.bedrooms)]);
  if (listing.areaM2 != null) entries.push(["Área", `${listing.areaM2} m²`]);
  if (listing.parkingSpots != null) entries.push(["Vagas", String(listing.parkingSpots)]);
  if (listing.brand != null) entries.push(["Marca", listing.brand]);
  if (listing.model != null) entries.push(["Modelo", listing.model]);
  if (listing.year != null) entries.push(["Ano", String(listing.year)]);
  if (listing.mileageKm != null) entries.push(["Km", listing.mileageKm.toLocaleString("pt-BR")]);
  return entries;
}

export function ListingsSection({ tenantId }: { tenantId: string }) {
  const [listings, setListings] = useState<any[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  async function loadPage(nextOffset: number) {
    setLoading(true);
    try {
      const result = await getTenantListings(tenantId, PAGE_SIZE, nextOffset);
      setListings((prev) => (nextOffset === 0 ? result.listings : [...prev, ...result.listings]));
      setTotal(result.total);
      setOffset(nextOffset);
    } catch {
      // Tolerate failures — listings panel should not blank the whole tenant page.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage(0);
  }, [tenantId]);

  if (total === null) {
    return <p className="text-ink-soft">Carregando…</p>;
  }

  if (total === 0) {
    return <p className="text-ink-soft">Nenhum anúncio extraído.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ref</TableHead>
              <TableHead>Título</TableHead>
              <TableHead>Tipo / Transação</TableHead>
              <TableHead>Preço</TableHead>
              <TableHead>Local</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Atualizado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listings.map((listing) => (
              <TableRow key={listing.id}>
                <TableCell className="break-words">{listing.referenceCode}</TableCell>
                <TableCell className="break-words">
                  {listing.title}
                  {extraFields(listing).length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {extraFields(listing).map(([label, value]) => (
                        <Badge key={label} variant="neutral">
                          {label}: {value}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {listing.manuallyCreated && <Badge variant="accent">manual</Badge>}
                    {listing.overriddenFields && Object.keys(listing.overriddenFields).length > 0 && (
                      <Badge variant="warning">{Object.keys(listing.overriddenFields).length} campos sobrescritos</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="break-words">
                  {[listing.listingType, listing.transaction].filter(Boolean).join(" / ") || "—"}
                </TableCell>
                <TableCell className="break-words">{formatPrice(listing)}</TableCell>
                <TableCell className="break-words">{formatLocation(listing)}</TableCell>
                <TableCell>
                  <Badge variant="neutral">{listing.status}</Badge>
                </TableCell>
                <TableCell className="break-words">{listing.sourceUrl ?? listing.sourceDocumentId ?? "—"}</TableCell>
                <TableCell className="break-words">{new Date(listing.updatedAt).toLocaleString("pt-BR")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2 lg:hidden">
        {listings.map((listing) => (
          <div key={listing.id} className="rounded-lg border border-border bg-bg-2 p-3">
            <div className="break-words font-semibold text-ink">{listing.title}</div>
            <div className="text-xs text-ink-soft">{listing.referenceCode}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-ink-soft">Tipo / Transação</div>
                <div className="break-words text-ink">
                  {[listing.listingType, listing.transaction].filter(Boolean).join(" / ") || "—"}
                </div>
              </div>
              <div>
                <div className="text-ink-soft">Preço</div>
                <div className="break-words text-ink">{formatPrice(listing)}</div>
              </div>
              <div>
                <div className="text-ink-soft">Local</div>
                <div className="break-words text-ink">{formatLocation(listing)}</div>
              </div>
              <div>
                <div className="text-ink-soft">Status</div>
                <div className="text-ink">
                  <Badge variant="neutral">{listing.status}</Badge>
                </div>
              </div>
              <div>
                <div className="text-ink-soft">Origem</div>
                <div className="break-words text-ink">{listing.sourceUrl ?? listing.sourceDocumentId ?? "—"}</div>
              </div>
              <div>
                <div className="text-ink-soft">Atualizado</div>
                <div className="break-words text-ink">{new Date(listing.updatedAt).toLocaleString("pt-BR")}</div>
              </div>
            </div>
            {extraFields(listing).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {extraFields(listing).map(([label, value]) => (
                  <Badge key={label} variant="neutral">
                    {label}: {value}
                  </Badge>
                ))}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {listing.manuallyCreated && <Badge variant="accent">manual</Badge>}
              {listing.overriddenFields && Object.keys(listing.overriddenFields).length > 0 && (
                <Badge variant="warning">{Object.keys(listing.overriddenFields).length} campos sobrescritos</Badge>
              )}
            </div>
          </div>
        ))}
      </div>

      {listings.length < total && (
        <Button variant="outline" size="sm" disabled={loading} onClick={() => loadPage(offset + PAGE_SIZE)}>
          {loading ? "Carregando…" : "Carregar mais"}
        </Button>
      )}
    </div>
  );
}
