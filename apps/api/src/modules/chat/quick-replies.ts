// Pure functions, no NestJS deps — the quick-reply mechanism for the conversational redesign
// (Stage 5). The gateway has no tool-calling/schema enforcement and chat is streamed
// token-by-token, so JSON would force full-response buffering — instead the model is asked to
// end its prose with a sentinel-delimited trailing line, e.g.
// "[[OPCOES: Alugar | Comprar | Ainda estou vendo]]", which these functions parse/strip.

const MAX_OPTIONS = 4;
const MAX_OPTION_LENGTH = 32;

// Matches a trailing "[[OPCOES: a | b | c]]"-shaped line, case-insensitive, accepting either
// "OPCOES" or "OPÇÕES" and either "|" or ";" as the option separator. Anchored to the end of the
// text (allowing trailing whitespace) since this is only ever a trailing line, never mid-prose.
const SENTINEL_PATTERN = /\n?\s*\[\[\s*OP[CÇ][OÕ]ES\s*:\s*([^\]]+?)\s*\]\]\s*$/i;

// 3+ consecutive digits is a price/area smell ("900000", "558"); "R$" is an unambiguous price
// marker. Either one on ANY option discards the whole option set — surfacing an invented number
// as a tappable chip is worse than offering no quick replies at all.
const NUMBER_SMELL_PATTERN = /\d{3,}/;
const PRICE_MARKER_PATTERN = /R\$/i;

export function parseQuickReplies(fullText: string): { text: string; options: string[] } {
  const match = fullText.match(SENTINEL_PATTERN);
  if (!match) return { text: fullText, options: [] };

  const text = fullText.slice(0, match.index).trimEnd();
  const rawOptions = match[1].split(/[|;]/).map((o) => o.trim()).filter(Boolean);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawOptions) {
    const option = raw.slice(0, MAX_OPTION_LENGTH).trim();
    if (!option) continue;
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(option);
    if (deduped.length >= MAX_OPTIONS) break;
  }

  const hasNumberOrPriceSmell = deduped.some(
    (option) => NUMBER_SMELL_PATTERN.test(option) || PRICE_MARKER_PATTERN.test(option),
  );

  return { text, options: hasNumberOrPriceSmell ? [] : deduped };
}

// Given an accumulating stream buffer, returns the prefix safe to flush immediately and the
// suffix to hold back because it could be (or already is) the "[[OPCOES: ...]]" sentinel. The
// model only ever emits this sentinel as the FINAL trailing line of its response, so there is no
// legitimate reason to flush it to the visitor at any point — complete or not. Once the buffer
// contains a "[[", everything from that "[[" onward is held back until stream end, even after the
// closing "]]" arrives; stream-end processing (parseQuickReplies) then either discards it (valid
// sentinel) or flushes it as normal text (not actually a sentinel).
const PARTIAL_OPEN_PATTERN = /\[\[[\s\S]*$/;

export function splitQuickReplyStream(buffer: string): { safeToEmit: string; held: string } {
  const match = buffer.match(PARTIAL_OPEN_PATTERN);
  if (!match || match.index === undefined) {
    return { safeToEmit: buffer, held: "" };
  }
  return { safeToEmit: buffer.slice(0, match.index), held: buffer.slice(match.index) };
}
