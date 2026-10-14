// Turns a free-text onboarding-interview answer into a PROPOSED set of PharmacySettings values.
// Best effort and deterministic; anything not parsable returns {} so the owner types it himself.
// Nothing here is ever applied without the owner confirming (docs/pharmacy/API.md section 5.2).

import { parseBrazilianPrice } from "../listings/parse-brazilian-price";
import { fold } from "../pharmacy-common/format";
import { isValidCnpj, onlyDigits } from "./settings-validation";

export const PROPOSAL_LABELS: Record<string, string> = {
  modo_operacao: "Modo de operação",
  razao_social_cnpj: "Razão social e CNPJ",
  afe_licenca: "AFE",
  farmaceutico_responsavel: "Farmacêutico responsável (RT)",
  horario_funcionamento: "Horário de funcionamento",
  areas_entrega: "Áreas de entrega",
  taxa_entrega: "Taxa de entrega",
  pedido_minimo: "Pedido mínimo",
  retirada_loja: "Retirada em loja",
  limite_quantidade_item: "Quantidade máxima por item",
  produtos_exigem_farmaceutico: "Produtos que sempre exigem farmacêutico",
  formas_pagamento_entrega: "Formas de pagamento",
  politica_troca_devolucao: "Política de troca e devolução",
};

export type Proposed = Record<string, unknown>;

const CNPJ_RE = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/;

function parseIdentity(raw: string): Proposed {
  const out: Proposed = {};
  const m = raw.match(CNPJ_RE);
  if (m) {
    if (isValidCnpj(m[0])) out.cnpj = onlyDigits(m[0]);
    const name = raw.replace(m[0], "").replace(/\bcnpj\b\s*[:\-]?/i, "").replace(/[,;\-–:]+\s*$/g, "").replace(/^[\s,;\-–:]+/, "").trim();
    if (name.length >= 3 && name.length <= 150) out.legalName = name;
  } else if (raw.trim().length >= 3 && raw.trim().length <= 150) {
    out.legalName = raw.trim();
  }
  return out;
}

function parsePharmacist(raw: string): Proposed {
  const out: Proposed = {};
  const crf = raw.match(/CRF[\s\-/]*([A-Za-z]{2})?[\s\-/]*n?[º°.]?\s*(\d{3,7})/i);
  if (crf) {
    out.pharmacistCrf = `CRF${crf[1] ? `-${crf[1].toUpperCase()}` : ""} ${crf[2]}`;
  }
  const name = raw
    .replace(/CRF[\s\-/]*([A-Za-z]{2})?[\s\-/]*n?[º°.]?\s*\d{3,7}/i, "")
    .replace(/\b(farmac[eê]utic[oa]|respons[aá]vel|rt|dr\.?|dra\.?|[ée]|chama-se|o nome [ée])\b/gi, " ")
    .replace(/[,;()\-–:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length >= 3 && name.length <= 120 && !/\d/.test(name)) out.pharmacistName = name;
  return out;
}

function toMinutes(h: string, m?: string): string {
  return `${String(Math.min(Number(h), 23)).padStart(2, "0")}:${(m ?? "00").padStart(2, "0")}`;
}

const TIME_RANGE = /(\d{1,2})\s*(?:[:h]\s*(\d{2})?)?\s*(?:h|horas)?\s*(?:[àa]s|a|[-–]|at[ée])\s*(\d{1,2})\s*(?:[:h]\s*(\d{2})?)?\s*(?:h|horas)?/i;

type HourRow = { key: string; label: string; open: boolean; from?: string; to?: string };
const GROUPS: Array<{ key: string; label: string; re: RegExp }> = [
  { key: "weekdays", label: "Segunda a sexta", re: /(seg(unda)?|ter[cç]a|quarta|quinta|sexta|dias?\s+[uú]teis|\bsex\b|\bseg\b)/i },
  { key: "saturday", label: "Sábado", re: /(s[aá]b(ado)?)/i },
  { key: "sunday", label: "Domingo e feriados", re: /(dom(ingo)?|feriados?)/i },
];

export function parseOpeningHours(raw: string): HourRow[] | null {
  const text = raw.replace(/\n/g, ";");
  const rows = new Map<string, HourRow>();
  if (/24\s*h(oras)?/i.test(text) && !/s[aá]b|dom|seg/i.test(text)) {
    return GROUPS.map((g) => ({ key: g.key, label: g.label, open: true, from: "00:00", to: "23:59" }));
  }
  const segments = text.split(/[;,\n]|\.\s+|\s+e\s+(?=(?:s[aá]b|dom|feriado|seg))/i).map((s) => s.trim()).filter(Boolean);
  const allDays = /todos\s+os\s+dias|diariamente|todo\s+dia/i.test(text);
  for (const seg of segments) {
    const time = seg.match(TIME_RANGE);
    const closed = /fechad[oa]|n[aã]o\s+abre|sem\s+expediente/i.test(seg);
    const matched = GROUPS.filter((g) => g.re.test(seg));
    const targets = allDays && matched.length === 0 ? GROUPS : matched;
    if (targets.length === 0) continue;
    for (const g of targets) {
      if (closed && !time) rows.set(g.key, { key: g.key, label: g.label, open: false });
      else if (time) rows.set(g.key, { key: g.key, label: g.label, open: true, from: toMinutes(time[1], time[2]), to: toMinutes(time[3], time[4]) });
    }
  }
  // "Seg-Sex 8h-20h, Sáb 8h-18h" without commas split handled above by [;.]; also handle commas.
  if (rows.size === 0 && /,/.test(text)) {
    for (const seg of text.split(",").map((s) => s.trim())) {
      const time = seg.match(TIME_RANGE);
      const matched = GROUPS.filter((g) => g.re.test(seg));
      if (time) for (const g of matched) rows.set(g.key, { key: g.key, label: g.label, open: true, from: toMinutes(time[1], time[2]), to: toMinutes(time[3], time[4]) });
    }
  }
  if (rows.size === 0) return null;
  // A day group that was never mentioned is shown as closed so the owner sees and corrects it.
  return GROUPS.map((g) => rows.get(g.key) ?? { key: g.key, label: g.label, open: false });
}

export function parseDeliveryAreas(raw: string): Array<{ type: "district" | "cep_prefix"; value: string }> | null {
  const cleaned = raw.replace(/^\s*(bairros?|ceps?|atendemos|entregamos( em)?|áreas?)\s*[:\-]?\s*/i, "");
  const parts = cleaned.split(/[,;\n]| e (?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/).map((p) => p.trim().replace(/\.$/, "")).filter(Boolean);
  const out: Array<{ type: "district" | "cep_prefix"; value: string }> = [];
  for (const raw of parts) {
    const p = raw.replace(/^ceps?\s*[:\-]?\s*/i, "").trim();
    const digits = onlyDigits(p);
    if (digits.length >= 3 && digits.length <= 8 && /^[\d\s.\-*x]+$/i.test(p)) out.push({ type: "cep_prefix", value: digits.slice(0, 8) });
    else if (p.length >= 2 && p.length <= 80 && !/\d{3,}/.test(p)) out.push({ type: "district", value: p });
  }
  return out.length ? out.slice(0, 200) : null;
}

export function parseBoolean(raw: string): boolean | null {
  const f = fold(raw);
  if (/^(nao|n|nenhum|sem|nunca)\b/.test(f) || /\bnao\b.*\b(temos|fazemos|aceitamos|tem|ha)\b/.test(f) || /\bnao (temos|fazemos|tem|ha|oferecemos)/.test(f)) return false;
  if (/^(sim|s|temos|tem|claro|com certeza|fazemos|oferecemos|ha)\b/.test(f) || /\bsim\b/.test(f)) return true;
  return null;
}

export function parsePayments(raw: string): string[] | null {
  const f = fold(raw);
  const out: string[] = [];
  if (/\bpix\b/.test(f)) out.push("pix");
  if (/cart|credito|debito|maquininha/.test(f)) out.push("cartao");
  if (/dinheiro|especie|troco/.test(f)) out.push("dinheiro");
  if (/\bvale\b|\bvr\b|\bva\b|alimentacao|refeicao/.test(f)) out.push("vale");
  return out.length ? out : null;
}

function parseMoney(raw: string, zeroWords: RegExp): number | null {
  if (zeroWords.test(fold(raw))) return 0;
  const parsed = parseBrazilianPrice(raw);
  return parsed ? parsed.priceCents : null;
}

// ---- Operation mode (interview field `modo_operacao`) ------------------------------------------------
// Deterministic pt-BR classifier (works without a model). Returns null when the answer is missing,
// unclear or says both things: the interview then asks the owner to confirm explicitly.
const NEGATED_COMMERCE = /\b(sem|nao|nem)\b(?:\s+\w+){0,4}?\s+(estoque|vender|vendemos|vendo|venda|vendas|pedidos?|catalogo|comercio|carrinho|loja virtual)\b/g;
const COMMERCE_WORDS = /\b(estoque|vender|vendemos|vendo|venda|vendas|vendendo|pedidos?|catalogo|comercio|carrinho|ecommerce|e commerce|loja virtual|cadastrar produtos|controlar estoque|checkout)\b/;
const ATTENDANCE_WORDS = /\b(so|apenas|somente)\b(?:\s+\w+){0,2}\s+(atendimento|ia|escalar|escalacao|encaminh\w*|atendente|whatsapp)\b|\batendimento\b|\b(escalar|escalacao|escalonar|encaminhar|encaminhamos|encaminho)\b|\bwhatsapp\b|\bmodo atendimento\b/;

export function classifyOperationModeAnswer(raw: string): "commerce" | "attendance" | null {
  const f = fold(raw);
  if (!f) return null;
  const negated = new RegExp(NEGATED_COMMERCE.source, "g");
  const negHit = negated.test(f);
  const rest = f.replace(new RegExp(NEGATED_COMMERCE.source, "g"), " ");
  const commerce = COMMERCE_WORDS.test(rest);
  const attendance = negHit || ATTENDANCE_WORDS.test(rest);
  if (commerce && attendance) return null;
  if (commerce) return "commerce";
  if (attendance) return "attendance";
  return null;
}

/** Builds the `proposed` object for one interview field. `{}` = nothing parsable. */
export function parseProposal(fieldKey: string, raw: string): Proposed {
  const text = raw.trim();
  if (!text) return {};
  switch (fieldKey) {
    case "modo_operacao": {
      const mode = classifyOperationModeAnswer(text);
      return mode ? { operationMode: mode } : {};
    }
    case "razao_social_cnpj":
      return parseIdentity(text);
    case "afe_licenca": {
      const cleaned = text.replace(/^\s*(afe|autoriza[cç][aã]o( de funcionamento)?|licen[cç]a)\s*(n[º°.]?|n[uú]mero)?\s*[:\-]?\s*/i, "").trim();
      return cleaned.length >= 3 && cleaned.length <= 60 ? { afeNumber: cleaned } : {};
    }
    case "farmaceutico_responsavel":
      return parsePharmacist(text);
    case "horario_funcionamento": {
      const rows = parseOpeningHours(text);
      return rows ? { openingHours: rows } : {};
    }
    case "areas_entrega": {
      const areas = parseDeliveryAreas(text);
      return areas ? { deliveryAreas: areas } : {};
    }
    case "taxa_entrega": {
      const cents = parseMoney(text, /\b(gratis|gratuit[oa]|sem taxa|nao cobramos|sem custo)\b/);
      return cents === null ? {} : { deliveryFeeCents: cents };
    }
    case "pedido_minimo": {
      const cents = parseMoney(text, /\b(sem minimo|nao (ha|tem|existe)|nenhum|nao)\b/);
      return cents === null ? {} : { minOrderCents: cents };
    }
    case "retirada_loja": {
      const b = parseBoolean(text);
      return b === null ? {} : { pickupEnabled: b };
    }
    case "limite_quantidade_item": {
      if (/\b(sem limite|nao (ha|tem)|nenhum)\b/.test(fold(text))) return { maxQtyPerItemDefault: null };
      const n = text.match(/\d{1,3}/);
      return n && Number(n[0]) >= 1 ? { maxQtyPerItemDefault: Number(n[0]) } : {};
    }
    case "produtos_exigem_farmaceutico": {
      if (/\b(nenhum|nao|sem)\b/.test(fold(text)) && text.length < 25) return { pharmacistRequiredProductNames: [] };
      const names = text.split(/[,;\n]| e /).map((s) => s.trim()).filter((s) => s.length >= 3 && s.length <= 100);
      return names.length ? { pharmacistRequiredProductNames: names.slice(0, 50) } : {};
    }
    case "formas_pagamento_entrega": {
      const p = parsePayments(text);
      return p ? { paymentMethods: p } : {};
    }
    case "politica_troca_devolucao":
      return text.length <= 1000 ? { exchangePolicy: text } : {};
    default:
      return {};
  }
}
