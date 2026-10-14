// Form model for Farmácia settings: PharmacySettings <-> editable strings, and the diff that becomes the PUT body.
import type { PharmacySettings } from "../../../lib/pharmacy-api";
import { centsToInput, parseBRLToCents, digitsOnly } from "../../../lib/format";

export interface SettingsForm {
  legalName: string;
  cnpj: string;
  afeNumber: string;
  pharmacistName: string;
  pharmacistCrf: string;
  deliveryEnabled: boolean;
  deliveryFee: string;
  minOrder: string;
  areas: string;
  pickupEnabled: boolean;
  exchangePolicy: string;
  maxQty: string;
  autoConfirm: boolean;
  stockMaxAge: string;
  retentionDays: string;
  reminder: string;
  hours: PharmacySettings["openingHours"];
  payments: string[];
  chips: string;
}

export function toForm(s: PharmacySettings): SettingsForm {
  return {
    legalName: s.legalName ?? "",
    cnpj: s.cnpj ?? "",
    afeNumber: s.afeNumber ?? "",
    pharmacistName: s.pharmacistName ?? "",
    pharmacistCrf: s.pharmacistCrf ?? "",
    deliveryEnabled: s.deliveryEnabled,
    deliveryFee: centsToInput(s.deliveryFeeCents),
    minOrder: centsToInput(s.minOrderCents),
    areas: (s.deliveryAreas ?? []).map((a) => a.value).join(", "),
    pickupEnabled: s.pickupEnabled,
    exchangePolicy: s.exchangePolicy ?? "",
    maxQty: String(s.maxQtyPerItemDefault ?? ""),
    autoConfirm: s.autoConfirmEnabled,
    stockMaxAge: String(s.stockMaxAgeHours ?? 24),
    retentionDays: String(s.prescriptionRetentionDays ?? 30),
    reminder: String(s.orderReminderMinutes ?? 10),
    hours: (s.openingHours ?? []).map((h) => ({ ...h })),
    payments: [...(s.paymentMethods ?? [])],
    chips: (s.quickChips ?? []).join("\n"),
  };
}

export function parseAreas(text: string): PharmacySettings["deliveryAreas"] {
  return text
    .split(/[,\n;]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (/^\d{5}(-?\d{0,3})?$/.test(t) ? { type: "cep_prefix" as const, value: digitsOnly(t).slice(0, 5) } : { type: "district" as const, value: t }));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const IDENTITY_KEYS = ["legalName", "cnpj", "afeNumber", "pharmacistName", "pharmacistCrf"] as const;

/** Only the keys that changed (the API logs "list of changed keys"); returns an error string for invalid input. */
export function toPatch(f: SettingsForm, s: PharmacySettings): { patch: Partial<PharmacySettings>; error?: string } {
  const patch: Record<string, unknown> = {};
  const put = (key: keyof PharmacySettings, value: unknown) => {
    if (!same(value, s[key])) patch[key] = value;
  };
  const str = (v: string) => (v.trim() === "" ? null : v.trim());

  put("legalName", str(f.legalName));
  put("cnpj", f.cnpj.trim() === "" ? null : digitsOnly(f.cnpj));
  put("afeNumber", str(f.afeNumber));
  put("pharmacistName", str(f.pharmacistName));
  put("pharmacistCrf", str(f.pharmacistCrf));
  put("deliveryEnabled", f.deliveryEnabled);
  const fee = parseBRLToCents(f.deliveryFee || "0");
  if (fee === null) return { patch: {}, error: "Taxa de entrega inválida. Use um valor como 6,00." };
  put("deliveryFeeCents", fee);
  const min = parseBRLToCents(f.minOrder || "0");
  if (min === null) return { patch: {}, error: "Pedido mínimo inválido. Use um valor como 15,00." };
  put("minOrderCents", min);
  put("deliveryAreas", parseAreas(f.areas));
  put("pickupEnabled", f.pickupEnabled);
  put("exchangePolicy", str(f.exchangePolicy));
  const maxQty = Number(f.maxQty);
  if (!Number.isInteger(maxQty) || maxQty < 1) return { patch: {}, error: "A quantidade máxima por item precisa ser um número inteiro maior que zero." };
  put("maxQtyPerItemDefault", maxQty);
  put("autoConfirmEnabled", f.autoConfirm);
  put("stockMaxAgeHours", Number(f.stockMaxAge));
  const days = Number(f.retentionDays);
  if (!Number.isInteger(days) || days < 1) return { patch: {}, error: "Os dias de guarda das receitas precisam ser um número inteiro maior que zero." };
  put("prescriptionRetentionDays", days);
  const reminder = Number(f.reminder);
  if (!Number.isInteger(reminder) || reminder < 1) return { patch: {}, error: "O lembrete de pedido parado precisa ser um número de minutos maior que zero." };
  put("orderReminderMinutes", reminder);
  for (const h of f.hours) {
    if (h.open && (!h.from || !h.to || h.from >= h.to)) return { patch: {}, error: `Confira o horário de “${h.label}”: a abertura precisa ser antes do fechamento.` };
  }
  put("openingHours", f.hours);
  put("paymentMethods", f.payments);
  put("quickChips", f.chips.split("\n").map((c) => c.trim()).filter(Boolean).slice(0, 4));
  return { patch: patch as Partial<PharmacySettings> };
}

const KEY_LABELS: Partial<Record<keyof PharmacySettings, string>> = {
  legalName: "Razão social",
  cnpj: "CNPJ",
  afeNumber: "AFE",
  pharmacistName: "Farmacêutico responsável",
  pharmacistCrf: "CRF",
  deliveryEnabled: "Entrega",
  deliveryFeeCents: "Taxa de entrega",
  minOrderCents: "Pedido mínimo",
  deliveryAreas: "Áreas de entrega",
  pickupEnabled: "Retirada em loja",
  maxQtyPerItemDefault: "Quantidade máxima por item",
  autoConfirmEnabled: "Confirmação automática",
  stockMaxAgeHours: "Idade máxima da planilha (horas)",
  openingHours: "Horários",
  paymentMethods: "Formas de pagamento",
  exchangePolicy: "Política de troca",
  prescriptionRetentionDays: "Guarda das receitas (dias)",
  orderReminderMinutes: "Lembrete de pedido parado (min)",
  quickChips: "Atalhos do chat",
};

/** Human text for one proposed value (shown on the proposal card). */
export function describeProposed(key: string, value: unknown): string {
  const label = KEY_LABELS[key as keyof PharmacySettings] ?? key;
  let text: string;
  if (typeof value === "boolean") text = value ? "ligado" : "desligado";
  else if (key.endsWith("Cents") && typeof value === "number") text = `R$ ${centsToInput(value)}`;
  else if (key === "deliveryAreas" && Array.isArray(value)) text = (value as { value: string }[]).map((a) => a.value).join(", ");
  else if (key === "openingHours" && Array.isArray(value))
    text = (value as PharmacySettings["openingHours"]).map((h) => `${h.label}: ${h.open ? `${h.from} às ${h.to}` : "fechado"}`).join("; ");
  else if (Array.isArray(value)) text = value.join(", ");
  else text = String(value ?? "—");
  return `${label}: ${text}`;
}

/** Settings keys covered by a pending proposal => the field shows a "confirmar" badge. */
export function pendingKeys(proposals: Record<string, { status: string; proposed: Record<string, unknown> }>): Set<string> {
  const set = new Set<string>();
  for (const p of Object.values(proposals)) if (p.status === "pending") for (const k of Object.keys(p.proposed ?? {})) set.add(k);
  return set;
}

// Form field -> settings key, so each input can show the "confirmar" badge.
export const FIELD_KEY = {
  legalName: "legalName",
  cnpj: "cnpj",
  afeNumber: "afeNumber",
  pharmacistName: "pharmacistName",
  pharmacistCrf: "pharmacistCrf",
  deliveryEnabled: "deliveryEnabled",
  deliveryFee: "deliveryFeeCents",
  minOrder: "minOrderCents",
  areas: "deliveryAreas",
  pickupEnabled: "pickupEnabled",
  exchangePolicy: "exchangePolicy",
  maxQty: "maxQtyPerItemDefault",
  autoConfirm: "autoConfirmEnabled",
  stockMaxAge: "stockMaxAgeHours",
  retentionDays: "prescriptionRetentionDays",
  reminder: "orderReminderMinutes",
  hours: "openingHours",
  payments: "paymentMethods",
  chips: "quickChips",
} as const satisfies Record<string, keyof PharmacySettings>;
