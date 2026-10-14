import { BadRequestException } from "@nestjs/common";
import { formatBRL } from "../pharmacy-common/format";

export const IDENTITY_KEYS = ["legalName", "cnpj", "afeNumber", "pharmacistName", "pharmacistCrf"] as const;

export const SETTING_LABELS: Record<string, string> = {
  legalName: "razão social",
  cnpj: "CNPJ",
  afeNumber: "AFE",
  pharmacistName: "farmacêutico responsável",
  pharmacistCrf: "CRF do farmacêutico",
  deliveryEnabled: "entrega",
  deliveryFeeCents: "taxa de entrega",
  minOrderCents: "pedido mínimo",
  deliveryAreas: "áreas de entrega",
  pickupEnabled: "retirada em loja",
  maxQtyPerItemDefault: "quantidade máxima por item",
  autoConfirmEnabled: "confirmação automática",
  stockMaxAgeHours: "validade do estoque",
  openingHours: "horários de funcionamento",
  paymentMethods: "formas de pagamento",
  exchangePolicy: "política de troca",
  prescriptionRetentionDays: "retenção de receitas",
  orderReminderMinutes: "lembrete de pedido parado",
  quickChips: "atalhos do chat",
  operationMode: "modo de operação",
};

export const PAYMENT_METHODS = ["pix", "cartao", "dinheiro", "vale"] as const;

function bad(message: string, key: string) {
  return new BadRequestException({ statusCode: 400, error: "Bad Request", code: "INVALID_SETTING", message, field: key });
}

export function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

/** CNPJ with both check digits (14 digits, not all equal). */
export function isValidCnpj(input: string): boolean {
  const d = onlyDigits(input);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function str(v: unknown, key: string, max: number): string | null {
  if (v === null || v === "") return null;
  if (typeof v !== "string") throw bad(`Valor inválido para ${SETTING_LABELS[key] ?? key}.`, key);
  const t = v.trim();
  if (t.length > max) throw bad(`${SETTING_LABELS[key] ?? key}: no máximo ${max} caracteres.`, key);
  return t || null;
}
function int(v: unknown, key: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw bad(`${SETTING_LABELS[key] ?? key}: informe um número inteiro entre ${min} e ${max}.`, key);
  }
  return v;
}
function bool(v: unknown, key: string): boolean {
  if (typeof v !== "boolean") throw bad(`${SETTING_LABELS[key] ?? key}: use verdadeiro ou falso.`, key);
  return v;
}

export function normalizeDeliveryAreas(v: unknown): Array<{ type: "district" | "cep_prefix"; value: string }> {
  if (!Array.isArray(v) || v.length > 500) throw bad("Áreas de entrega inválidas.", "deliveryAreas");
  const out: Array<{ type: "district" | "cep_prefix"; value: string }> = [];
  for (const item of v) {
    const type = item?.type;
    const value = typeof item?.value === "string" ? item.value.trim() : "";
    if (type === "cep_prefix") {
      const digits = onlyDigits(value);
      if (digits.length < 3 || digits.length > 8) throw bad(`Prefixo de CEP inválido: ${value}`, "deliveryAreas");
      out.push({ type, value: digits });
    } else if (type === "district") {
      if (!value || value.length > 80) throw bad("Bairro inválido.", "deliveryAreas");
      out.push({ type, value });
    } else {
      throw bad("Tipo de área inválido (use district ou cep_prefix).", "deliveryAreas");
    }
  }
  return out;
}

export function normalizeOpeningHours(v: unknown) {
  if (!Array.isArray(v) || v.length > 14) throw bad("Horários inválidos.", "openingHours");
  return v.map((row) => {
    const key = typeof row?.key === "string" ? row.key.slice(0, 40) : "";
    const label = typeof row?.label === "string" ? row.label.slice(0, 60) : "";
    if (!key || !label) throw bad("Cada horário precisa de key e label.", "openingHours");
    const open = row.open === true;
    if (!open) return { key, label, open: false };
    if (!TIME.test(row.from ?? "") || !TIME.test(row.to ?? "")) throw bad(`Horário inválido em "${label}" (use HH:MM).`, "openingHours");
    return { key, label, open: true, from: row.from as string, to: row.to as string };
  });
}

export interface SettingsPatchResult {
  data: Record<string, unknown>;
  changedKeys: string[];
}

/** Validates a partial settings patch against the current row and returns only the columns that change. */
export function buildSettingsPatch(current: Record<string, unknown>, patch: Record<string, unknown>): SettingsPatchResult {
  const data: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(patch)) {
    if (raw === undefined) continue;
    switch (key) {
      case "legalName":
        data[key] = str(raw, key, 150);
        break;
      case "afeNumber":
        data[key] = str(raw, key, 60);
        break;
      case "pharmacistName":
        data[key] = str(raw, key, 120);
        break;
      case "pharmacistCrf":
        data[key] = str(raw, key, 40);
        break;
      case "cnpj": {
        const s = str(raw, key, 30);
        if (s === null) data[key] = null;
        else if (!isValidCnpj(s)) throw bad("CNPJ inválido.", key);
        else data[key] = onlyDigits(s);
        break;
      }
      case "deliveryFeeCents":
      case "minOrderCents":
        data[key] = int(raw, key, 0, 1_000_000);
        break;
      case "maxQtyPerItemDefault":
        data[key] = raw === null ? null : int(raw, key, 1, 999);
        break;
      case "stockMaxAgeHours":
        data[key] = int(raw, key, 1, 720);
        break;
      case "prescriptionRetentionDays":
        data[key] = int(raw, key, 1, 365);
        break;
      case "orderReminderMinutes":
        data[key] = int(raw, key, 1, 240);
        break;
      case "deliveryEnabled":
      case "pickupEnabled":
      case "autoConfirmEnabled":
        data[key] = bool(raw, key);
        break;
      case "operationMode":
        if (raw !== "commerce" && raw !== "attendance") throw bad("Modo de operação inválido (use commerce ou attendance).", key);
        data[key] = raw;
        break;
      case "deliveryAreas":
        data[key] = normalizeDeliveryAreas(raw);
        break;
      case "openingHours":
        data[key] = normalizeOpeningHours(raw);
        break;
      case "paymentMethods": {
        if (!Array.isArray(raw) || raw.length > 8) throw bad("Formas de pagamento inválidas.", key);
        const list = [...new Set(raw.map((p) => String(p).toLowerCase().trim()))];
        if (list.some((p) => !(PAYMENT_METHODS as readonly string[]).includes(p))) throw bad(`Formas de pagamento aceitas: ${PAYMENT_METHODS.join(", ")}.`, key);
        data[key] = list;
        break;
      }
      case "exchangePolicy":
        data[key] = str(raw, key, 1000);
        break;
      case "quickChips": {
        if (!Array.isArray(raw) || raw.length > 6 || raw.some((c) => typeof c !== "string" || !c.trim() || c.length > 60)) throw bad("Atalhos do chat inválidos (até 6, 60 caracteres cada).", key);
        data[key] = raw.map((c: string) => c.trim());
        break;
      }
      default:
        // proposals / counters / ids are not editable through PUT; unknown keys are ignored on purpose.
        break;
    }
  }
  const changedKeys = Object.keys(data).filter((k) => JSON.stringify(data[k]) !== JSON.stringify(current[k]));
  return { data, changedKeys };
}

/** "Alterou taxa de entrega para R$ 6,00" / "Alterou horários de funcionamento e retirada em loja". No PII. */
export function settingsSummary(changedKeys: string[], data: Record<string, unknown>): string {
  if (changedKeys.length === 0) return "Salvou as configurações da farmácia";
  const identity = changedKeys.some((k) => (IDENTITY_KEYS as readonly string[]).includes(k));
  const parts = changedKeys
    .filter((k) => !(IDENTITY_KEYS as readonly string[]).includes(k))
    .map((k) => {
      const label = SETTING_LABELS[k] ?? k;
      if ((k === "deliveryFeeCents" || k === "minOrderCents") && typeof data[k] === "number") return `${label} para ${formatBRL(data[k] as number)}`;
      return label;
    });
  if (identity) parts.unshift("identidade legal");
  return `Alterou ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}` : parts[0]}`;
}
