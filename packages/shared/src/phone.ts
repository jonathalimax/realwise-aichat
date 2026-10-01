export function maskBrPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  const ddd = digits.slice(0, 2);
  const isMobile = digits.length > 10;
  const prefix = isMobile ? digits.slice(2, 7) : digits.slice(2, 6);
  const suffix = isMobile ? digits.slice(7, 11) : digits.slice(6, 10);

  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${ddd}`;
  if (digits.length <= (isMobile ? 7 : 6)) return `(${ddd}) ${prefix}`;
  return `(${ddd}) ${prefix}-${suffix}`;
}

export function brPhoneToE164(masked: string): string {
  const digits = masked.replace(/\D/g, "");
  return `+55${digits}`;
}

export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}
