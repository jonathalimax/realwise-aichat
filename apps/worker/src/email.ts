const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.TRANSACTIONAL_FROM_EMAIL ?? "Realwise <avisos@realwise.com.br>";

// Any value interpolated into an email's HTML body must go through this — visitor-controlled
// text (e.g. a lead's name) is otherwise HTML/script-injectable into the owner's inbox.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Returns true only on a confirmed successful send — callers that need to know whether to
// act as if the recipient was actually notified (e.g. anti-spam/notified flags) should check it.
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY not set — skipping send to ${to}: "${subject}"`);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    });
    if (!res.ok) {
      console.error(`[email] send failed (${res.status}) to ${to}:`, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[email] send threw for ${to}:`, err);
    return false;
  }
}
