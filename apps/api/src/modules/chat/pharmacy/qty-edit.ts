// Quantity edits typed in the chat ("quero 2", "mais um", "tira um", "só 1", "na verdade são 3", "remove").
// Pure parsing: the engine applies the result to the focused / last-added cart line, validating limits and stock.

import { fold } from "./text";

const WORDS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
const NUM = "(\\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)";
const UNIT = "(?: (?:unidades?|caixas?|unid|dessas?|desses?))?";

export type QtyEdit = { op: "set" | "add" | "sub"; n: number; target?: string } | { op: "remove"; target?: string };

function num(token: string): number {
  return /^\d+$/.test(token) ? Number(token) : WORDS[token];
}

const SET_VERBS = "(?:quero|coloca|colocar|poe|bota|mude|muda|mudar|altera|alterar|troca|trocar|deixa|deixe|ajusta|ajuste|fica|vai ser|seria|sao|e|so|apenas|somente|na verdade(?: (?:sao|quero|seria|e|vai ser|fica|so))?|ao inves disso)";

const RE_SET = new RegExp(`^${SET_VERBS}(?: (?:para|pra|em|so|apenas|somente))? ${NUM}${UNIT}$`);
const RE_SET_TARGET = new RegExp(`^${SET_VERBS}(?: (?:para|pra|em))? ${NUM}${UNIT} (?:da|de|do|das|dos|na|no|a|o)\\s+(.+)$`);
const RE_ADD = new RegExp(`^(?:mais|adiciona|adicionar|acrescenta|acrescentar|coloca mais|poe mais|bota mais)(?: mais)? ${NUM}${UNIT}$`);
const RE_SUB = new RegExp(`^(?:tira|tirar|retira|retirar|menos|remove|remover) ${NUM}${UNIT}$`);
const RE_REMOVE = /^(?:remove|remover|tira|tirar|retira|retirar|exclui|excluir|apaga|apagar|deleta|nao quero (?:mais )?(?:esse|essa|isso|ele|ela)|esquece (?:esse|essa|isso))(?: (?:esse|essa|isso|ele|ela|o item|esse item|esse produto|do carrinho|o ultimo|esse ai))*$/;

/** null when the sentence is not a quantity edit. */
export function parseQtyEdit(text: string): QtyEdit | null {
  const f = fold(text);
  if (!f || f.split(" ").length > 9) return null;
  let m = f.match(RE_ADD);
  if (m) return { op: "add", n: num(m[1]) };
  m = f.match(RE_SUB);
  if (m) return { op: "sub", n: num(m[1]) };
  if (RE_REMOVE.test(f)) return { op: "remove" };
  m = f.match(RE_SET);
  if (m) return { op: "set", n: num(m[1]) };
  m = f.match(RE_SET_TARGET);
  if (m) return { op: "set", n: num(m[1]), target: m[2] };
  return null;
}
