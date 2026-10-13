// Post-generation grounding guard for figures. Pure functions, no NestJS deps.
//
// The model is told (in the system prompt) to only state figures present in the data it was given.
// This is the deterministic check behind that rule: every figure in the answer (R$ values, areas,
// room/parking counts, percentages, clock times, and any other 3+ digit number) must also appear
// in the grounding context (KB chunks, profile, listing data, selection, earlier assistant replies).
// Sentences carrying a figure that doesn't are dropped, never "corrected" — we don't know the
// right value, so the only safe move is to not state one.
//
// What this does NOT cover (by design, documented in the PR): spelled-out numbers ("dois
// quartos"), non-numeric claims (e.g. "aceita pet" when the KB says nothing), and a figure that
// exists in the context but is attributed to the wrong thing (e.g. the condo fee of listing A
// quoted for listing B). The prompt rules and the entity-claim guard cover part of that space.

export type FigureKind = "money" | "area" | "count" | "percent" | "time" | "number";

export interface Figure {
  raw: string;
  kind: FigureKind;
  // Candidate numeric readings (pt-BR "2.500" is 2500, but a model could also mean 2.5).
  values: number[];
  unit?: string;
}

const COUNT_UNITS: Array<[RegExp, string]> = [
  [/^(quartos?|dormit[oó]rios?|dorms?|qts?)$/i, "quarto"],
  [/^(su[ií]tes?)$/i, "suite"],
  [/^(banheiros?|wcs?|lavabos?)$/i, "banheiro"],
  [/^(vagas?|garagens?)$/i, "vaga"],
  [/^(andar(es)?|pavimentos?)$/i, "andar"],
  [/^(meses)$/i, "mes"],
  [/^(anos?)$/i, "ano"],
  [/^(km|quil[oô]metros?)$/i, "km"],
  [/^(parcelas?|vezes|x)$/i, "parcela"],
];

function unitFamily(word: string): string | null {
  for (const [pattern, family] of COUNT_UNITS) if (pattern.test(word)) return family;
  return null;
}

// All plausible numeric readings of a pt-BR number token ("2.500,00", "2500", "1,5", "450.000").
export function numericReadings(token: string): number[] {
  const t = token.replace(/\s/g, "");
  const readings = new Set<number>();
  const hasDot = t.includes(".");
  const hasComma = t.includes(",");
  if (hasDot && hasComma) {
    readings.add(Number(t.replace(/\./g, "").replace(",", ".")));
  } else if (hasComma) {
    readings.add(Number(t.replace(",", ".")));
    if (/^\d{1,3}(,\d{3})+$/.test(t)) readings.add(Number(t.replace(/,/g, "")));
  } else if (hasDot) {
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) readings.add(Number(t.replace(/\./g, "")));
    readings.add(Number(t));
  } else {
    readings.add(Number(t));
  }
  return [...readings].filter((n) => Number.isFinite(n));
}

function scale(values: number[], multiplierWord: string | undefined): number[] {
  if (!multiplierWord) return values;
  const word = multiplierWord.toLowerCase();
  const factor = word === "mil" || word === "k" ? 1000 : word === "mi" || word.startsWith("milh") ? 1_000_000 : 1;
  return values.map((v) => v * factor);
}

// The lookbehind keeps every pattern from restarting inside a long "1.1.1.1…" run (which made the
// scan quadratic on large contexts).
const NUMBER = String.raw`(?<![\d.,])\d+(?:[.,]\d+)*`;
const MULTIPLIER = String.raw`(?:\s?(milh(?:ão|ao|ões|oes)|mi\b|mil\b|k\b))?`;

const MONEY_RE = new RegExp(String.raw`R\$\s?(${NUMBER})${MULTIPLIER}|\b(${NUMBER})\s?(milh(?:ão|ao|ões|oes)|mil\b|mi\b)?\s?reais\b|\b(${NUMBER})\s(milh(?:ão|ao|ões|oes)|mil)\b`, "gi");
const AREA_RE = new RegExp(String.raw`\b(${NUMBER})\s?(?:m²|m2|metros quadrados|metros)(?![a-zà-ÿ])`, "gi");
const PERCENT_RE = new RegExp(String.raw`\b(${NUMBER})\s?(?:%|por cento)`, "gi");
const TIME_RE = /(?<![\d.,])\b([01]?\d|2[0-3])(?::([0-5]\d)|\s?h(?:s|oras?)?\s?([0-5]\d)?)(?![a-zà-ÿ\d])/gi;
// "das 9 às 18h", "9-18h", "das 9 até as 18": the first endpoint has no "h" of its own.
const TIME_RANGE_RE = /\b([01]?\d|2[0-3])(?::([0-5]\d))?\s*h?\s*(?:às|as|a|-|–|até|ate)\s*(?:as\s+|às\s+)?([01]?\d|2[0-3])(?::([0-5]\d))?\s*h?/gi;
const COUNT_RE = new RegExp(String.raw`\b(${NUMBER})\s?([a-zà-ÿ]+)`, "gi");
const BARE_RE = new RegExp(String.raw`\b(${NUMBER})\b`, "g");

// Extracts every figure in the text. Overlapping matches are resolved by kind priority (money >
// area > percent > time > count > bare number) so "R$ 2.500" is one money figure, not also a bare
// number.
export function extractFigures(text: string): Figure[] {
  const taken: Array<[number, number]> = [];
  const figures: Figure[] = [];
  const overlaps = (start: number, end: number) => taken.some(([s, e]) => start < e && end > s);
  const push = (match: RegExpExecArray, figure: Figure) => {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(start, end)) return;
    taken.push([start, end]);
    figures.push(figure);
  };

  for (const match of text.matchAll(MONEY_RE)) {
    const token = match[1] ?? match[3] ?? match[5];
    const multiplier = match[2] ?? match[4] ?? match[6];
    push(match, { raw: match[0], kind: "money", values: scale(numericReadings(token), multiplier) });
  }
  for (const match of text.matchAll(AREA_RE)) push(match, { raw: match[0], kind: "area", values: numericReadings(match[1]) });
  for (const match of text.matchAll(PERCENT_RE)) push(match, { raw: match[0], kind: "percent", values: numericReadings(match[1]) });
  for (const match of text.matchAll(TIME_RE)) {
    const hour = Number(match[1]);
    const minute = Number(match[2] ?? match[3] ?? 0);
    push(match, { raw: match[0], kind: "time", values: [hour * 60 + minute] });
  }
  for (const match of text.matchAll(COUNT_RE)) {
    const family = unitFamily(match[2]);
    if (!family) continue;
    push(match, { raw: match[0], kind: "count", values: numericReadings(match[1]), unit: family });
  }
  for (const match of text.matchAll(BARE_RE)) {
    const digits = match[1].replace(/\D/g, "");
    // 1-2 digit bare numbers ("1 dos imóveis", list numbering, "24h" already handled) carry too
    // little signal to police; 3+ digits (prices without R$, years, phone fragments) do.
    if (digits.length < 3) continue;
    push(match, { raw: match[0], kind: "number", values: numericReadings(match[1]) });
  }
  return figures;
}

export interface GroundingIndex {
  numbers: Set<number>;
  percents: Set<number>;
  times: Set<number>;
  counts: Set<string>;
}

function key(value: number): number {
  return Math.round(value * 100) / 100;
}

// Everything numeric the context legitimately states, in every reading we accept.
export function buildGroundingIndex(contextText: string): GroundingIndex {
  const index: GroundingIndex = { numbers: new Set(), percents: new Set(), times: new Set(), counts: new Set() };
  for (const figure of extractFigures(contextText)) {
    if (figure.kind === "time") {
      figure.values.forEach((v) => index.times.add(v));
      continue;
    }
    if (figure.kind === "percent") {
      figure.values.forEach((v) => index.percents.add(key(v)));
      continue;
    }
    if (figure.kind === "count" && figure.unit) {
      // A count grounds only the same count ("3 quartos" never grounds "R$ 3").
      figure.values.forEach((v) => index.counts.add(`${key(v)}:${figure.unit}`));
      continue;
    }
    figure.values.forEach((v) => index.numbers.add(key(v)));
  }
  // Both endpoints of an hours range count as stated times.
  for (const match of contextText.matchAll(TIME_RANGE_RE)) {
    if (!/h|:|das|às|as|até|ate/i.test(match[0])) continue;
    index.times.add(Number(match[1]) * 60 + Number(match[2] ?? 0));
    index.times.add(Number(match[3]) * 60 + Number(match[4] ?? 0));
  }
  // Raw 3+ digit number tokens too (a figure the extractor classified differently in the context,
  // e.g. "Condomínio 450" with no R$, still counts as stated). 1-2 digit bare tokens are too
  // ambiguous ("dia 10", list item "3.") to ground a money/percent figure.
  for (const match of contextText.matchAll(BARE_RE)) {
    if (match[1].replace(/\D/g, "").length < 3) continue;
    numericReadings(match[1]).forEach((v) => index.numbers.add(key(v)));
  }
  // "450 mil" in the context also grounds "R$ 450.000" in the answer (handled by MONEY_RE scaling);
  // "1.200/ano" grounds the monthly "R$ 100" only if the context says so — no arithmetic here.
  return index;
}

export function isFigureSupported(figure: Figure, index: GroundingIndex): boolean {
  switch (figure.kind) {
    case "time":
      return figure.values.some((v) => index.times.has(v));
    case "count":
      return figure.values.some((v) => index.counts.has(`${key(v)}:${figure.unit}`));
    case "percent":
      return figure.values.some((v) => index.percents.has(key(v)));
    default:
      return figure.values.some((v) => index.numbers.has(key(v)));
  }
}

export function findUnsupportedFigures(answer: string, contextText: string): Figure[] {
  const index = buildGroundingIndex(contextText);
  return extractFigures(answer).filter((figure) => !isFigureSupported(figure, index));
}

// Splits into sentences while keeping line structure (markdown "- " list items are their own
// unit), so dropping one claim never glues two unrelated lines together.
function splitUnits(text: string): string[][] {
  return text.split("\n").map((line) => line.split(/(?<=[.!?])\s+(?=[^\s])/));
}

export interface StripResult {
  text: string;
  removed: string[];
}

// Drops every sentence that states a figure the context doesn't support. Returns the remaining
// text (possibly empty) and the figures that were removed.
// `allowQuestions`: a sentence that asks ("Você procura até R$ 500 mil?") asserts nothing, so its
// figures are not claims — used for discovery turns, which may only ask.
export function stripUnsupportedFigures(answer: string, contextText: string, opts: { allowQuestions?: boolean } = {}): StripResult {
  const index = buildGroundingIndex(contextText);
  const removed: string[] = [];
  const lines = splitUnits(answer).map((sentences) =>
    sentences
      .filter((sentence) => {
        if (opts.allowQuestions && /\?\s*$/.test(sentence.trim())) return true;
        const bad = extractFigures(sentence).filter((figure) => !isFigureSupported(figure, index));
        if (bad.length === 0) return true;
        removed.push(...bad.map((f) => f.raw.trim()));
        return false;
      })
      .join(" "),
  );
  const text = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .filter((line, i, all) => line.trim() !== "" || (i > 0 && all[i - 1].trim() !== ""))
    .join("\n")
    .trim();
  return { text, removed };
}
