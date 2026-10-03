// LLM-parsed JSON isn't trusted input — only ever accept a genuine http(s) URL for a listing
// url/imageUrl, never a javascript:/data: scheme a malformed or adversarial model response could emit.
export function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}
