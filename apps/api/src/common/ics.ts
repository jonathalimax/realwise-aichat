// RFC 5545 iCalendar generation for booking confirmation emails. Output must use CRLF
// line endings (mandatory per spec) and fold lines over 75 octets with a single-space
// continuation — most mail/calendar clients reject or mangle unfolded/LF-only output.

// Escapes text per RFC 5545 §3.3.11 — every interpolated value (visitor/owner/LLM-extracted
// text) must go through this before being placed in a VEVENT property value.
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function formatIcsTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

// Folds a single "KEY:VALUE" (or similar) content line at 75 octets, continuation lines
// prefixed with CRLF + a single space, per RFC 5545 §3.1.
function foldLine(line: string): string {
  const CHUNK = 75;
  if (Buffer.byteLength(line, "utf8") <= CHUNK) return line;

  const folded: string[] = [];
  let current = "";
  let isFirstChunk = true;
  for (const char of line) {
    const candidate = current + char;
    // Continuation lines are rendered with a leading space (CRLF + " " + chunk) — that leading
    // space itself counts toward the 75-octet limit, so every chunk after the first can only hold
    // 74 octets of real content.
    const limit = isFirstChunk ? CHUNK : CHUNK - 1;
    if (Buffer.byteLength(candidate, "utf8") > limit) {
      folded.push(current);
      isFirstChunk = false;
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) folded.push(current);
  return folded.join("\r\n ");
}

export interface BuildIcsInput {
  uid: string;
  summary: string;
  description: string;
  location?: string;
  startsAt: Date;
  endsAt: Date;
  url?: string;
}

export function buildIcs(input: BuildIcsInput): string {
  // Truncate first, then escape — escaping can expand length (e.g. "," -> "\,"), and the ~800
  // char cap is meant to bound the pre-escape source text, not fight the escaper afterwards.
  const truncatedDescription = input.description.length > 800 ? `${input.description.slice(0, 800)}...` : input.description;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Realwise//Booking//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${input.uid}@realwise.com.br`,
    `DTSTAMP:${formatIcsTimestamp(new Date())}`,
    `DTSTART:${formatIcsTimestamp(input.startsAt)}`,
    `DTEND:${formatIcsTimestamp(input.endsAt)}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
    `DESCRIPTION:${escapeIcsText(truncatedDescription)}`,
    ...(input.location ? [`LOCATION:${escapeIcsText(input.location)}`] : []),
    ...(input.url ? [`URL:${escapeIcsText(input.url)}`] : []),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(foldLine).join("\r\n") + "\r\n";
}
