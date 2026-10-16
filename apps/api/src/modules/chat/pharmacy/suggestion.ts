// Pharmacist suggestion -> purchase. The pharmacist's reply may carry structured products
// (Message.uiData `{ type: "pharmacist_suggestion", from, note?, items[] }`). Pure parsing helpers.

import { fold } from "./text";

export type SuggestionChoice = { kind: "all" } | { kind: "index"; index: number };

const ORDINALS: Record<string, number> = { primeiro: 0, primeira: 0, segundo: 1, segunda: 1, terceiro: 2, terceira: 2, quarto: 3, quarta: 3 };

const OBJECTS = ["", " esses", " essas", " isso", " isto", " tudo", " todos", " todas", " os dois", " as duas", " ai"];
const BUY_ALL = new Set<string>(
  [
    ...["quero comprar", "quero levar", "queria comprar", "vou levar", "vou querer", "vou comprar", "comprar", "adicionar", "adiciona", "colocar", "coloca", "fechar com"].flatMap((v) => OBJECTS.map((o) => `${v}${o}`)),
    ...["quero", "queria"].flatMap((v) => OBJECTS.filter(Boolean).map((o) => `${v}${o}`)),
    "pode ser", "pode sim", "pode ser esses", "pode ser isso", "ok pode ser", "sim quero", "quero sim", "sim pode", "quero comprar sim", "sim pode ser",
  ],
);
// bare verbs that must not count on their own
for (const bare of ["adicionar", "adiciona", "colocar", "coloca", "fechar com"]) BUY_ALL.delete(bare);

/** "quero comprar", "quero esses", "vou levar", "pode ser", "quero o primeiro" ... (short sentences only). */
export function parseSuggestionChoice(f: string): SuggestionChoice | null {
  if (f.split(" ").length > 8) return null;
  const ord = f.match(/^(?:quero|vou querer|vou levar|pode ser|adiciona|adicionar|coloca|colocar)?\s*(?:so )?(?:o|a|os|as)?\s*(primeiro|primeira|segundo|segunda|terceiro|terceira|quarto|quarta)(?: item| produto| deles| delas)?$/);
  if (ord) return { kind: "index", index: ORDINALS[ord[1]] };
  const n = f.match(/^(?:quero|vou querer|vou levar) (?:o |a )?(?:item |produto )?(?:numero |n |n°)?(\d)$/);
  if (n && Number(n[1]) >= 1) return { kind: "index", index: Number(n[1]) - 1 };
  if (BUY_ALL.has(f)) return { kind: "all" };
  return null;
}

/** Whole-sentence buy intent after a suggestion also includes "fazer um pedido" style starts (checked by the caller). */
export function isSuggestionMessage(row: { kind?: string | null; uiData?: unknown }): boolean {
  const ui = row.uiData as { type?: string } | null | undefined;
  return row.kind === "pharmacist_suggestion" || ui?.type === "pharmacist_suggestion";
}

export { fold };
