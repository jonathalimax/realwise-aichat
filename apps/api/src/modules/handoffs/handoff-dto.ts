import { HANDOFF_REASON_LABEL, handoffTag } from "../pharmacy-common/labels";
import { formatBRL, minutesSince } from "../pharmacy-common/format";
import { maskPhoneBr, whatsappDigits } from "./whatsapp-message";

type Brief = Record<string, unknown>;

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(", ");
  if (typeof v === "object" && typeof (v as { name?: unknown }).name === "string") return (v as { name: string }).name;
  return "";
}

/**
 * Rows of the pharmacist panel, built from whichever brief keys exist (2a writes the keys, API.md 7.3),
 * in the prototype's order and wording. Controlled / out-of-stock handoffs use the second group.
 */
export function buildBriefRows(brief: Brief | null | undefined): Array<{ label: string; value: string }> {
  const b = brief ?? {};
  const rows: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: string) => {
    if (value) rows.push({ label, value });
  };
  add("Sintoma", asText(b.symptoms));
  add("Duração", asText(b.duration));
  add("Intensidade", asText(b.severity));
  const fw = (b.forWhom ?? null) as { relation?: unknown; age?: unknown; pregnant?: unknown; pregnancyAnswer?: unknown } | null;
  if (fw && typeof fw === "object") {
    const relation = asText(fw.relation);
    const age = asText(fw.age);
    add("Para quem", [relation, age].filter(Boolean).join(", "));
    if (fw.pregnant === true) add("Gestante", "Sim");
    else if (fw.pregnant === false) add("Gestante", "Não");
    else add("Gestante", asText(fw.pregnancyAnswer));
  } else {
    add("Para quem", asText(b.forWhom));
  }
  add("Alergias", asText(b.allergies));
  add("Outros remédios", asText(b.otherMedicines));
  add("Já tentou", asText(b.alreadyTried));
  add("Sinais de alerta", asText(b.redFlags));
  // controlled / out-of-stock group
  add("Medicamento", asText(b.medication));
  add("Produto pedido", asText(b.product ?? b.requestedProduct));
  add("Disponibilidade", asText(b.availability));
  add("Estoque", asText(b.stock ?? b.stockInfo));
  if (typeof b.priceInformedCents === "number") add("Preço informado", formatBRL(b.priceInformedCents));
  if (b.onlineSaleAllowed === false) add("Venda online", "Não permitida");
  else if (b.onlineSaleAllowed === true) add("Venda online", "Permitida");
  add("Equivalentes", asText(b.equivalents));
  add("Pedido do cliente", asText(b.customerRequest));
  add("Mensagem do cliente", asText(b.customerText));
  add("Mensagens adicionais", asText(b.followUps));
  return rows;
}

export interface HandoffRow {
  id: string;
  conversationId: string;
  reason: keyof typeof HANDOFF_REASON_LABEL;
  urgent: boolean;
  summary: string;
  brief: unknown;
  status: "open" | "answered" | "closed";
  answerText: string | null;
  answeredAt: Date | null;
  answeredByName: string | null;
  answeredByRole: string | null;
  createdAt: Date;
  lead: { name: string | null; phone?: string | null } | null;
}

export function whoLabel(h: Pick<HandoffRow, "lead" | "brief">): string {
  const first = h.lead?.name?.trim().split(/\s+/)[0] ?? "Cliente";
  const age = asText(((h.brief ?? {}) as Brief).forWhom && typeof (h.brief as Brief).forWhom === "object" ? ((h.brief as Brief).forWhom as { age?: unknown }).age : "");
  return age ? `${first}, ${age}` : first;
}

export interface InProgressMarker {
  at: string;
  byMemberId: string | null;
  byName: string;
  byRole: string;
  channel: "whatsapp" | "chat";
}

/** "Em atendimento" marker kept in brief.inProgress (no schema column; status stays open/answered/closed). */
export function readInProgress(brief: unknown): InProgressMarker | null {
  const m = brief && typeof brief === "object" ? (brief as Brief).inProgress : null;
  if (!m || typeof m !== "object") return null;
  const v = m as Record<string, unknown>;
  if (typeof v.byName !== "string" || !v.byName) return null;
  return {
    at: typeof v.at === "string" ? v.at : "",
    byMemberId: typeof v.byMemberId === "string" ? v.byMemberId : null,
    byName: v.byName,
    byRole: typeof v.byRole === "string" ? v.byRole : "",
    channel: v.channel === "chat" ? "chat" : "whatsapp",
  };
}

/** Display-only contact: first name + masked phone. The full number is only returned by the WhatsApp draft endpoint. */
export function contactDto(h: Pick<HandoffRow, "lead" | "brief">) {
  const stored = ((h.brief ?? {}) as Brief).contact;
  const storedContact = stored && typeof stored === "object" ? (stored as { firstName?: unknown; phoneMasked?: unknown }) : null;
  const phone = h.lead?.phone ?? null;
  const hasPhone = whatsappDigits(phone) !== null;
  const firstName = h.lead?.name?.trim().split(/\s+/)[0] || (typeof storedContact?.firstName === "string" ? storedContact.firstName : null);
  const phoneMasked = hasPhone ? maskPhoneBr(phone) : typeof storedContact?.phoneMasked === "string" ? storedContact.phoneMasked : null;
  return { firstName: firstName || null, phoneMasked, hasPhone };
}

export function handoffListDto(h: HandoffRow, now = Date.now()) {
  const tag = handoffTag(h.reason, h.urgent);
  const inProgress = h.status === "open" ? readInProgress(h.brief) : null;
  return {
    id: h.id,
    who: whoLabel(h),
    customerName: h.lead?.name?.trim().split(/\s+/)[0] ?? "Cliente",
    urgent: h.urgent,
    tag: tag.tag,
    tagBadge: tag.tagBadge,
    reason: h.reason,
    reasonLabel: HANDOFF_REASON_LABEL[h.reason],
    summary: h.summary,
    status: h.status,
    createdAt: h.createdAt.toISOString(),
    waitingMinutes: h.status === "open" ? minutesSince(h.createdAt, now) : 0,
    conversationId: h.conversationId,
    inProgress,
    hasPhone: contactDto(h).hasPhone,
  };
}

export interface SuggestionProduct {
  productId: string;
  name: string;
  reason: string;
  inStock: boolean;
  priceCents: number;
}

/** Only products that are in stock RIGHT NOW (checked against the catalog by the service) are suggested. */
export function buildSuggestion(brief: Brief | null | undefined, liveInStock: Map<string, { name: string; priceCents: number; stockQty: number | null }>) {
  const raw = Array.isArray(brief?.suggestedProducts) ? (brief!.suggestedProducts as Array<Record<string, unknown>>) : [];
  const products: SuggestionProduct[] = [];
  for (const p of raw) {
    const id = typeof p?.productId === "string" ? p.productId : "";
    const live = liveInStock.get(id);
    if (!live || (live.stockQty ?? 0) <= 0) continue;
    products.push({ productId: id, name: live.name, reason: asText(p.reason), inStock: true, priceCents: live.priceCents });
  }
  if (!products.length) return null;
  const allergies = asText(brief?.allergies);
  const first = products[0];
  const text = [`${first.name} · em estoque · ${formatBRL(first.priceCents)}.`, allergies ? `Alergia informada: ${allergies}.` : ""].filter(Boolean).join(" ");
  return { label: "Sugestão para o farmacêutico, não enviada ao cliente", text, products };
}

export function handoffDetailDto(
  h: HandoffRow,
  suggestion: ReturnType<typeof buildSuggestion>,
  now = Date.now(),
) {
  const brief = (h.brief && typeof h.brief === "object" ? h.brief : {}) as Brief;
  return {
    ...handoffListDto(h, now),
    brief,
    briefRows: buildBriefRows(brief),
    contact: contactDto(h),
    suggestion,
    conversationLink: `/conversas?open=${h.conversationId}`,
    answer: h.answeredAt && h.answerText ? { text: h.answerText, at: h.answeredAt.toISOString(), byName: h.answeredByName, byRole: h.answeredByRole } : null,
  };
}
