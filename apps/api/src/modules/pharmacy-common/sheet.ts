// Stale-sheet logic: the catalog stock sheet (CatalogImport.stockAsOf) has an age; past
// PharmacySettings.stockMaxAgeHours it can no longer back an automatic order confirmation.

export interface SheetStatus {
  asOf: string | null;
  ageHours: number | null;
  maxAgeHours: number;
  /** true only when a sheet exists and is older than maxAgeHours. */
  stale: boolean;
  /** true when auto-confirm may rely on the sheet: it exists and is within maxAgeHours. */
  fresh: boolean;
}

export function sheetStatus(stockAsOf: Date | null | undefined, maxAgeHours: number, now: number = Date.now()): SheetStatus {
  if (!stockAsOf) return { asOf: null, ageHours: null, maxAgeHours, stale: false, fresh: false };
  const ageMs = Math.max(0, now - stockAsOf.getTime());
  const ageHours = Math.floor(ageMs / 3600000);
  const stale = ageMs > maxAgeHours * 3600000;
  return { asOf: stockAsOf.toISOString(), ageHours, maxAgeHours, stale, fresh: !stale };
}

/** "Estoque atualizado há 5h" / "há 2 dias". */
export function sheetAgeLabel(ageHours: number | null): string {
  if (ageHours === null) return "Estoque ainda não importado";
  if (ageHours < 1) return "Estoque atualizado há menos de 1h";
  if (ageHours < 48) return `Estoque atualizado há ${ageHours}h`;
  return `Estoque atualizado há ${Math.floor(ageHours / 24)} dias`;
}
