// Public customer-chat link: `<origin>/<slug>/chat` (same scheme as apps/api/src/common/chat-links.ts).
// NEXT_PUBLIC_CHAT_URL may be a bare origin or the legacy `<origin>/client/conversation`.
export function chatPublicLink(slug: string): string {
  const raw = process.env.NEXT_PUBLIC_CHAT_URL || "http://localhost:3005";
  let origin = raw.replace(/\/+$/, "");
  try {
    origin = new URL(raw).origin;
  } catch {}
  return `${origin}/${encodeURIComponent(slug)}/chat`;
}
