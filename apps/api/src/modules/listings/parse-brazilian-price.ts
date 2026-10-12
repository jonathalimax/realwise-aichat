export interface ParsedPrice {
  priceCents: number;
  pricePeriod?: "month";
}

// Matches the full contiguous numeric span (digits plus "." and "," separators) so we never
// accidentally match just a leading fragment of a longer number (e.g. "588000.00" truncated to
// "588").
const NUMERIC_SPAN_PATTERN = /\d[\d.,]*\d|\d/;

// Parses currency text (Brazilian "R$ 1.250.000,00" or plain "588000.00" style) into cents — a
// parse failure must return null, never guess/round to something plausible-looking.
export function parseBrazilianPrice(text: string): ParsedPrice | null {
  if (!text) return null;

  const isMonthly = /\/\s*m[eê]s|\bmensal\b|\baluguel\b/i.test(text);

  const match = text.match(NUMERIC_SPAN_PATTERN);
  if (!match) return null;
  const raw = match[0];

  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");
  const decimalSepIndex = Math.max(lastDot, lastComma);

  let normalized: string;
  if (decimalSepIndex === -1) {
    normalized = raw;
  } else {
    const fractionalDigits = raw.length - decimalSepIndex - 1;
    // A separator followed by exactly 1-2 digits at the very end is the decimal separator —
    // everything before it (any "." or ",") is a thousands grouping separator to strip.
    if (fractionalDigits >= 1 && fractionalDigits <= 2) {
      const integerPart = raw.slice(0, decimalSepIndex).replace(/[.,]/g, "");
      const fractionalPart = raw.slice(decimalSepIndex + 1);
      normalized = `${integerPart}.${fractionalPart}`;
    } else {
      // No real decimal part (e.g. "1.250.000") — every separator is a thousands grouping.
      normalized = raw.replace(/[.,]/g, "");
    }
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;

  const priceCents = Math.round(value * 100);
  return isMonthly ? { priceCents, pricePeriod: "month" } : { priceCents };
}
