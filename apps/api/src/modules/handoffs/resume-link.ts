// Visitor "resume" link: opens the SAME conversation (with its history) in the web chat, on any device, with no cookie.
// URL scheme lives in common/chat-links.ts; GET history accepts ?t=<resumeToken>.
import { chatBaseOrigin, chatLink } from "../../common/chat-links";

/** @deprecated kept for callers/tests: the chat origin (no path). Use chatBaseOrigin(). */
export function chatBaseUrl(env: string | undefined = process.env.NEXT_PUBLIC_CHAT_URL): string {
  return chatBaseOrigin(env);
}

export function buildChatResumeLink(input: { slug: string; conversationId: string; resumeToken?: string | null; baseUrl?: string }): string {
  return chatLink(input.slug, { conversationId: input.conversationId, resumeToken: input.resumeToken, baseUrl: input.baseUrl });
}
