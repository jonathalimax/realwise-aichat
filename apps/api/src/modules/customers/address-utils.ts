// Pure helpers for the customer profile (Appendix A): phone canonicalization, address number
// normalization, masking and the "differs from saved" comparison. No Nest / DB dependencies.

import { normalizePhone } from "@realwise/auth";

/**
 * Canonical phone key (Lead.phoneNormalized). Same result as the widget's brPhoneToE164 +
 * normalizePhone: "(41) 99812-3344", "41998123344" and "+5541998123344" all become "+5541998123344".
 */
export function canonicalPhone(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  if (trimmed.startsWith("+")) return normalizePhone(trimmed);
  // Brazilian national numbers (DDD + 8/9 digits) get the country code.
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return normalizePhone(`+${digits}`);
}

export function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

export class InvalidAddressNumberError extends Error {
  constructor() {
    super("Número inválido. Use apenas dígitos (ex.: 12), dígitos e uma letra (ex.: 12B) ou \"s/n\".");
  }
}

const NO_NUMBER = /^(s\s*[\/.\-]?\s*n(º|o|\.)?|sn|n\s*[\/.\-]?\s*a|na|n\s*\/\s*a|sem\s+n(u|ú)mero|sem\s+numero|s\s*\/\s*n(º|o))$/i;

/**
 * "12" -> "12"; "12b" / "12 B" / " 12-b " -> "12B"; "s/n", "S/N", "sn", "n/a", "NA", "sem número" -> "S/N".
 * Anything else throws InvalidAddressNumberError (the caller asks again).
 */
export function normalizeAddressNumber(input: string): string {
  const raw = (input ?? "").trim();
  if (!raw) throw new InvalidAddressNumberError();
  if (NO_NUMBER.test(raw)) return "S/N";
  const compact = raw.replace(/[\s.\-\/]/g, "").toUpperCase();
  if (/^\d{1,6}[A-Z]?$/.test(compact)) return compact.replace(/^0+(?=\d)/, "");
  throw new InvalidAddressNumberError();
}

export function normalizeCep(input: string): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  return digits.length === 8 ? digits : null;
}

export function formatCep(cep8: string): string {
  return `${cep8.slice(0, 5)}-${cep8.slice(5)}`;
}

export interface AddressFields {
  cep: string;
  street: string;
  number: string;
  complement?: string | null;
  reference?: string | null;
  district: string;
  city: string;
  state: string;
}

export interface MaskedAddress {
  id: string;
  /** "Rua das Flores, nº •••, Água Verde" (the street number is always hidden). */
  label: string;
  street: string;
  numberMasked: "•••";
  district: string;
  city: string;
  state: string;
  /** "80250-•••" */
  cepMasked: string;
  isDefault: boolean;
}

export const NUMBER_MASK = "•••";

/** What an unverified (phone-only) visitor may see about a saved address. No number, complement or reference. */
export function maskAddress(address: AddressFields & { id: string; isDefault: boolean }): MaskedAddress {
  const cep = address.cep.replace(/\D/g, "");
  return {
    id: address.id,
    label: `${address.street}, nº ${NUMBER_MASK}, ${address.district}`,
    street: address.street,
    numberMasked: NUMBER_MASK,
    district: address.district,
    city: address.city,
    state: address.state,
    cepMasked: cep.length === 8 ? `${cep.slice(0, 5)}-•••` : "•••",
    isDefault: address.isDefault,
  };
}

function fold(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** True when two addresses are the same place for ordering purposes (cep + street + number + complement). */
export function sameAddress(a: AddressFields, b: AddressFields): boolean {
  return (
    a.cep.replace(/\D/g, "") === b.cep.replace(/\D/g, "") &&
    fold(a.street) === fold(b.street) &&
    a.number.toUpperCase() === b.number.toUpperCase() &&
    fold(a.complement) === fold(b.complement)
  );
}

/**
 * Flag for the order sheet ("difere do salvo"): the order's address differs from the customer's saved
 * default. No saved default -> nothing to differ from -> false. Pickup orders (no address) -> false.
 */
export function addressDiffersFromSaved(orderAddress: AddressFields | null | undefined, savedDefault: AddressFields | null | undefined): boolean {
  if (!orderAddress || !savedDefault) return false;
  return !sameAddress(orderAddress, savedDefault);
}
