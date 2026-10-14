const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Money is always integer cents in the API.
export function formatBRL(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "";
  return brl.format(cents / 100).replace(/ /g, " ");
}

export function maskCep(input: string): string {
  const d = input.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase();
}

// Links coming from the model/engine must be http(s) (or same-site relative) before being rendered.
export function safeLink(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const v = url.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  return null;
}
