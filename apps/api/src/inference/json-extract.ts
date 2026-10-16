/**
 * Tolerant JSON extraction for model answers. Reasoning models may wrap the answer in markdown fences,
 * prefix it with prose or <think> blocks, or append trailing commentary. Returns the first balanced
 * top-level JSON object (string-aware), or null. Never throws.
 */
export function extractJsonObject(text: string | null | undefined): Record<string, unknown> | null {
  const v = extractJson(text, false);
  return v as Record<string, unknown> | null;
}

/** Like extractJsonObject but also accepts a bare top-level array (smaller models often drop the wrapper object). */
export function extractJsonValue(text: string | null | undefined): Record<string, unknown> | unknown[] | null {
  return extractJson(text, true) as Record<string, unknown> | unknown[] | null;
}

function extractJson(text: string | null | undefined, allowArray: boolean): unknown | null {
  if (!text) return null;
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, " ").replace(/```(?:json|JSON)?/g, " ");
  for (let start = nextOpen(cleaned, 0, allowArray); start >= 0; start = nextOpen(cleaned, start + 1, allowArray)) {
    const end = balancedEnd(cleaned, start);
    if (end < 0) continue;
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // try the next opener
    }
  }
  return null;
}

function nextOpen(s: string, from: number, allowArray: boolean): number {
  const o = s.indexOf("{", from);
  if (!allowArray) return o;
  const a = s.indexOf("[", from);
  if (o < 0) return a;
  if (a < 0) return o;
  return Math.min(o, a);
}

function balancedEnd(s: string, start: number): number {
  const open = s[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  return -1;
}
