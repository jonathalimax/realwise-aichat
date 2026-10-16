// Deterministic core of "apply": decides, row by row, whether the import creates a product, updates
// an existing one (without touching owner-edited fields) or skips it. No DB access: callers pass
// the existing catalog in and write the resulting plan themselves.

import type { SaleClass } from "../pharmacy-common/labels";
import { dedupKeyFor, normalizeProductName, proposeClass, type ClassProposal } from "../products/product-utils";
import type { NormalizedRow, RowResult } from "./column-mapping";

export interface ExistingProductLite {
  id: string;
  name: string;
  presentation: string | null;
  ean: string | null;
  dedupKey: string;
  saleClass: SaleClass;
  classConfirmedAt: Date | null;
  classProposed: SaleClass | null;
  overriddenFields: Record<string, boolean>;
}

export interface PlannedCreate {
  row: NormalizedRow;
  dedupKey: string;
  proposal: ClassProposal | null;
}
export interface PlannedUpdate {
  row: NormalizedRow;
  existing: ExistingProductLite;
  /** Column values to write (already excludes owner-overridden fields and empty cells). */
  patch: Record<string, unknown>;
  newDedupKey?: string;
  proposal: ClassProposal | null;
}
export interface ImportPlan {
  rows: number;
  creates: PlannedCreate[];
  updates: PlannedUpdate[];
  /** Duplicates inside the file and fully empty rows (first occurrence wins). */
  skipped: number;
  /** Rows with a name but no usable price, or a price but no name. */
  rejected: number;
  classSummary: Record<SaleClass, number>;
  samples: Record<SaleClass, Array<{ name: string; by: string }>>;
}

const NAME_KEY = (p: { name: string; presentation?: string | null }) => `name:${normalizeProductName(p.name)}|${normalizeProductName(p.presentation)}`;

export function buildExistingIndex(existing: ExistingProductLite[]) {
  const byKey = new Map<string, ExistingProductLite>();
  const byName = new Map<string, ExistingProductLite>();
  for (const p of existing) {
    byKey.set(p.dedupKey, p);
    const nk = NAME_KEY(p);
    if (!byName.has(nk)) byName.set(nk, p);
  }
  return { byKey, byName };
}

const UPDATABLE: Array<[keyof NormalizedRow, string]> = [
  ["name", "name"],
  ["priceCents", "priceCents"],
  ["stockQty", "stockQty"],
  ["presentation", "presentation"],
  ["manufacturer", "manufacturer"],
  ["ean", "ean"],
  ["sku", "sku"],
  ["activeIngredient", "activeIngredient"],
  ["category", "category"],
  ["equivalentGroup", "equivalentGroup"],
];

export function planImport(
  results: RowResult[],
  existing: ExistingProductLite[],
  modelProposals: Map<string, ClassProposal> = new Map(),
): ImportPlan {
  const index = buildExistingIndex(existing);
  const seen = new Set<string>();
  const plan: ImportPlan = {
    rows: 0,
    creates: [],
    updates: [],
    skipped: 0,
    rejected: 0,
    classSummary: { controlled: 0, prescription: 0, otc: 0, unclassified: 0 },
    samples: { controlled: [], prescription: [], otc: [], unclassified: [] },
  };
  for (const res of results) {
    if (!res.ok) {
      if (res.reason === "empty") plan.skipped++;
      else {
        plan.rows++;
        plan.rejected++;
      }
      continue;
    }
    plan.rows++;
    const row = res.row;
    const key = dedupKeyFor(row);
    const nameKey = NAME_KEY(row);
    if (seen.has(key) || seen.has(nameKey)) {
      plan.skipped++;
      continue;
    }
    seen.add(key);
    seen.add(nameKey);

    const proposal =
      proposeClass({ name: row.name, activeIngredient: row.activeIngredient, classCell: row.classCell, classColumnName: row.classColumnName }) ??
      modelProposals.get(key) ??
      null;
    const cls: SaleClass = proposal?.class ?? "unclassified";
    plan.classSummary[cls]++;
    if (plan.samples[cls].length < 3) plan.samples[cls].push({ name: row.name, by: proposal?.reason ?? "sem proposta" });

    const match = index.byKey.get(key) ?? index.byName.get(nameKey);
    if (!match) {
      plan.creates.push({ row, dedupKey: key, proposal });
      continue;
    }
    const patch: Record<string, unknown> = {};
    for (const [src, col] of UPDATABLE) {
      const value = row[src];
      if (value === null || value === undefined) continue; // an empty cell never blanks existing data
      if (match.overriddenFields[col]) continue; // owner edited this field: re-imports must not overwrite it
      patch[col] = value;
    }
    let newDedupKey: string | undefined;
    if (row.ean && !match.ean && key.startsWith("ean:") && key !== match.dedupKey) newDedupKey = key;
    plan.updates.push({ row, existing: match, patch, newDedupKey, proposal });
  }
  return plan;
}

/** What to write for the class proposal of one touched product. A confirmed class is never touched here. */
export function classProposalPatch(existing: ExistingProductLite | null, proposal: ClassProposal | null) {
  if (!proposal) return {};
  return { classProposed: proposal.class, classProposedBy: proposal.by, classProposedReason: proposal.reason };
}
