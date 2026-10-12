import { buildWaMeLink, digitsOnly } from "@realwise/shared";
import { escapeHtml } from "./email";
import { safeHttpUrl } from "./safe-http-url";

// Production emails must never link to localhost — if DASHBOARD_URL isn't set in production,
// omit the link entirely rather than falling back to a dev-only address.
export function dashboardLink(path: string): string | undefined {
  const base = process.env.DASHBOARD_URL;
  if (!base && process.env.NODE_ENV === "production") return undefined;
  const trimmedBase = (base ?? "http://localhost:3003").replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${trimmedBase}${normalizedPath}`;
  return safeHttpUrl(url);
}

export function renderEmailButton(label: string, url: string | undefined): string {
  if (!url) return "";
  return `<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 16px;background:#111827;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600;">${escapeHtml(label)}</a></p>`;
}

export function renderWaButton(phone: string | null | undefined, message: string, label: string): string {
  if (!phone) return "";
  const digits = digitsOnly(phone);
  const nationalDigits = digits.startsWith("55") ? digits.slice(2) : digits;
  if (nationalDigits.length !== 10 && nationalDigits.length !== 11) return "";
  return renderEmailButton(label, safeHttpUrl(buildWaMeLink(phone, message)));
}
