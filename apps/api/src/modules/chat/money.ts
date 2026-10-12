// Parses a single pt-BR monetary expression into integer cents. Supports "R$ 400.000",
// "400.000,50", "400 mil", "400k". Returns null when nothing parseable is found.
export function parseMoneyToCents(raw: string): number | null {
  let text = raw.trim().toLowerCase();
  text = text.replace(/^r\$\s?/, "");

  let multiplier = 1;
  if (/milh(?:ão|ao|ões|oes)|\bmi\b/.test(text)) {
    multiplier = 1_000_000;
    text = text.replace(/milh(?:ão|ao|ões|oes)|\bmi\b/, "").trim();
  } else if (/\bmil\b/.test(text)) {
    multiplier = 1000;
    text = text.replace(/\bmil\b/, "").trim();
  } else if (/k$/.test(text)) {
    multiplier = 1000;
    text = text.replace(/k$/, "").trim();
  }

  // Disambiguate Brazilian "." (thousands) vs "," (decimal): if both present, "." is thousands
  // and "," is decimal. If only "." present and followed by exactly 3 digits groups, treat as
  // thousands separator (common "400.000"); otherwise treat as decimal.
  let normalized = text;
  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");
  if (hasComma && hasDot) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = normalized.replace(",", ".");
  } else if (hasDot) {
    // "400.000" (thousands) vs "400.5" (decimal) — a trailing group of exactly 3 digits after the
    // last dot means it's a thousands separator, not a decimal fraction.
    const parts = normalized.split(".");
    const last = parts[parts.length - 1];
    if (last.length === 3) {
      normalized = parts.join("");
    }
  }

  const value = parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * multiplier * 100);
}

// Same money shapes simulator.service.ts matches: "R$ 150.000", "150.000,00", "150 mil", "150k".
// "milhão"/"mi" are matched before "mil" (and "mil"/"k" need a word boundary) so "R$ 1 milhão" is
// never read as "R$ 1 mil".
export const MONEY_PATTERN =
  /r\$\s?[\d.,]+(?:\s?(?:milh(?:ão|ao|ões|oes)|mi\b|mil\b|k\b))?|\b\d+(?:[.,]\d+)?\s?(?:milh(?:ão|ao|ões|oes)|mi\b|mil\b|k\b)|\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/i;

// First monetary expression in free text, in cents (null when none / unparseable).
export function extractFirstMoneyCents(text: string): number | null {
  const match = text.match(MONEY_PATTERN);
  if (!match) return null;
  return parseMoneyToCents(match[0]);
}
