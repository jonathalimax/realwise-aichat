// pt-BR formatting helpers shared by every dashboard page.

export function formatBRL(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "R$ 8,90" or "8,90" (typed by a person) -> cents. Returns null if it is not a valid amount. */
export function parseBRLToCents(input: string): number | null {
  const cleaned = input.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export function centsToInput(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "nunca";
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ontem";
  if (d < 7) return `há ${d} dias`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}

export function waitingLabel(minutes: number): string {
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const h = Math.floor(minutes / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.floor(h / 24)} d`;
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
}

/** "Hoje 09:42", "Ontem 17:20" or "12 set 09:42". */
export function formatLogWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Hoje ${hm}`;
  if (d.toDateString() === y.toDateString()) return `Ontem ${hm}`;
  return `${d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" })} ${hm}`;
}

export function formatCnpj(v: string | null | undefined): string {
  const d = (v ?? "").replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function digitsOnly(v: string): string {
  return v.replace(/\D/g, "");
}

/** Product/logo URLs from the API are relative to the API origin ("/api/public/products/<id>/image"). */
export function assetUrl(path: string | null | undefined, apiBase: string): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  try {
    return new URL(path, new URL(apiBase).origin).toString();
  } catch {
    return path;
  }
}

/** Short, human text for a conversation list preview: no raw URLs, JSON or UI payloads. */
export function previewText(raw: string | null | undefined): string {
  let t = (raw ?? "").trim();
  if (!t) return "";
  if (/^[{[]/.test(t) || /uiData|"type"\s*:/.test(t)) return "Mensagem com opções";
  // "Pedido PED-1016 confirmado! Acompanhe: http://…" -> "Pedido PED-1016 confirmado"
  const order = t.match(/Pedido\s+(PED-\d+)\s+(confirmado|recebido|cancelado|pronto)/i);
  if (order) return `Pedido ${order[1]} ${order[2].toLowerCase()}`;
  // The chat answers carry light markdown ("**Horário de atendimento**\n- Segunda a sexta"): the list shows plain text.
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/^\s*[-•]\s+/gm, "");
  t = t.replace(/https?:\/\/([^\s/]+)[^\s]*/gi, (_m, host: string) => `${host}…`);
  t = t.replace(/\s*(Acompanhe|Acompanhe o status)\s*:\s*$/i, "").replace(/\s+/g, " ").trim();
  return t.length > 140 ? `${t.slice(0, 137)}…` : t;
}

/** Splits text into plain and URL parts so long links can be shown shortened. */
export function shortUrlLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.length > 1 ? "/…" : ""}`;
  } catch {
    return url.slice(0, 30) + "…";
  }
}
