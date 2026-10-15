// Visitor "resume" link: opens the SAME conversation (with its history) in the web chat, on any device, with no cookie.
// The chat app is served under basePath /client/conversation (apps/chat/next.config.mjs); GET history accepts ?t=<resumeToken>.

const CHAT_BASE_PATH = "/client/conversation";

export function chatBaseUrl(env: string | undefined = process.env.NEXT_PUBLIC_CHAT_URL): string {
  const base = (env && env.trim() ? env.trim() : "http://localhost:3005").replace(/\/+$/, "");
  // Some deployments already include the basePath in NEXT_PUBLIC_CHAT_URL.
  return base.endsWith(CHAT_BASE_PATH) ? base : `${base}${CHAT_BASE_PATH}`;
}

export function buildChatResumeLink(input: { slug: string; conversationId: string; resumeToken?: string | null; baseUrl?: string }): string {
  const base = input.baseUrl ? chatBaseUrl(input.baseUrl) : chatBaseUrl();
  const t = input.resumeToken ? `&t=${encodeURIComponent(input.resumeToken)}` : "";
  return `${base}/${encodeURIComponent(input.slug)}?c=${encodeURIComponent(input.conversationId)}${t}`;
}
