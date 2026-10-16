// Single source of truth for public customer-chat URLs. Same domain for every niche:
//   chat   -> <origin>/<client-slug>/chat[?c=<conversationId>&t=<resumeToken>]
//   order  -> <origin>/<client-slug>/pedido/<token>
// The legacy scheme `<origin>/client/conversation/<slug>` is redirected (308) by the chat app (next.config.mjs).
// See docs/pharmacy/URLS.md.

const LEGACY_BASE_PATH = "/client/conversation";
const DEV_DEFAULT_ORIGIN = "http://localhost:3005";

/**
 * Origin of the chat app. NEXT_PUBLIC_CHAT_URL may be a bare origin (`https://aichat.realwise.com.br`)
 * or the legacy `<origin>/client/conversation` (or any path): both normalise to the origin.
 */
export function chatBaseOrigin(env: string | undefined = process.env.NEXT_PUBLIC_CHAT_URL): string {
  const raw = env && env.trim() ? env.trim() : DEV_DEFAULT_ORIGIN;
  try {
    return new URL(raw).origin;
  } catch {
    // Not an absolute URL: strip trailing slashes and the legacy path by hand.
    const stripped = raw.replace(/\/+$/, "");
    return stripped.endsWith(LEGACY_BASE_PATH) ? stripped.slice(0, -LEGACY_BASE_PATH.length) : stripped;
  }
}

export function chatLink(
  slug: string,
  opts: { conversationId?: string | null; resumeToken?: string | null; baseUrl?: string } = {},
): string {
  const origin = opts.baseUrl !== undefined ? chatBaseOrigin(opts.baseUrl) : chatBaseOrigin();
  const params: string[] = [];
  if (opts.conversationId) params.push(`c=${encodeURIComponent(opts.conversationId)}`);
  if (opts.conversationId && opts.resumeToken) params.push(`t=${encodeURIComponent(opts.resumeToken)}`);
  return `${origin}/${encodeURIComponent(slug)}/chat${params.length ? `?${params.join("&")}` : ""}`;
}

export function orderTrackingLink(slug: string, token: string, opts: { baseUrl?: string } = {}): string {
  const origin = opts.baseUrl !== undefined ? chatBaseOrigin(opts.baseUrl) : chatBaseOrigin();
  return `${origin}/${encodeURIComponent(slug)}/pedido/${encodeURIComponent(token)}`;
}

/** Maps a legacy path (`/client/conversation/<slug>`) to the new one, or null. Mirrors the redirect in apps/chat/next.config.mjs. */
export function legacyChatPathToNew(pathname: string): string | null {
  const m = /^\/client\/conversation\/([^/]+)\/?$/.exec(pathname);
  if (!m || m[1] === "pedido") return null;
  return `/${m[1]}/chat`;
}
