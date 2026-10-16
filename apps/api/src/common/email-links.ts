import { buildWaMeLink, dashboardBasePath, digitsOnly } from "@realwise/shared";
import { escapeHtml } from "./email";
import { safeHttpUrl } from "./safe-http-url";

const NICHE_PREFIXES = ["/imobiliaria/app", "/farmacia/app", "/concessionaria/app"];

/**
 * DASHBOARD_URL may be a bare origin (https://aichat.realwise.com.br) or, in older setups, include a niche prefix
 * (https://aichat.realwise.com.br/imobiliaria/app). Normalise to the bare origin so the niche prefix is added exactly once.
 */
export function dashboardOrigin(): string | undefined {
  const base = process.env.DASHBOARD_URL;
  if (!base && process.env.NODE_ENV === "production") return undefined;
  let origin = (base ?? "http://localhost:3003").replace(/\/+$/, "");
  for (const p of NICHE_PREFIXES) if (origin.endsWith(p)) origin = origin.slice(0, -p.length);
  return origin;
}

// Production emails must never link to localhost — if DASHBOARD_URL isn't set in production,
// omit the link entirely rather than falling back to a dev-only address.
// `path` is relative to the niche's dashboard (e.g. "/inbox"); a path that already starts with a niche prefix is kept as is.
export function dashboardLink(path: string, niche?: string | null): string | undefined {
  const origin = dashboardOrigin();
  if (!origin) return undefined;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const hasPrefix = NICHE_PREFIXES.some((p) => normalizedPath === p || normalizedPath.startsWith(`${p}/`) || normalizedPath.startsWith(`${p}?`));
  const url = `${origin}${hasPrefix ? "" : dashboardBasePath(niche as never)}${normalizedPath}`;
  return safeHttpUrl(url);
}

// The dashboard is the same app served under one prefix per niche
// (/imobiliaria/app, /farmacia/app, /concessionaria/app); defined once in @realwise/shared.
export { dashboardBasePath };

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
