// Small pure text helpers for the pharmacy chat engine (pt-BR). No Nest/DB dependencies.

/** lowercase, accents stripped, punctuation/emoji -> single spaces. */
export function fold(text: string | null | undefined): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const AFFIRM = new Set([
  "sim", "s", "ss", "isso", "isso mesmo", "claro", "pode", "pode ser", "pode sim", "ok", "okay", "certo", "certinho", "esta certo", "ta certo", "correto",
  "confirmo", "confirmar", "confirmar pedido", "pode confirmar", "quero", "uhum", "aham", "beleza", "blz", "perfeito", "combinado", "bora", "fechado",
]);
const NEGATE = new Set(["nao", "n", "nn", "nope", "negativo", "nao quero", "agora nao", "deixa", "deixa pra la", "melhor nao"]);

export function isAffirmative(text: string): boolean {
  const f = fold(text);
  if (!f) return false;
  if (AFFIRM.has(f)) return true;
  return /^(sim|pode|claro|confirmo|ok|certo|isso|concordo|autorizo|aceito)\b/.test(f) && f.split(" ").length <= 5 && !/\bnao\b/.test(f);
}

export function isNegative(text: string): boolean {
  const f = fold(text);
  if (!f) return false;
  return NEGATE.has(f) || /^(nao|nunca|negativo)\b/.test(f) && f.split(" ").length <= 4;
}

/** "R$ 8,90" from integer cents. */
export function brl(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const reais = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}R$ ${String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
}

const STOPWORDS = new Set([
  "a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das", "e", "ou", "em", "no", "na", "nos", "nas", "pra", "para", "por", "com", "sem",
  "eu", "voce", "vc", "meu", "minha", "me", "mim", "quero", "queria", "gostaria", "preciso", "precisava", "comprar", "pedir", "pedido", "adicionar", "adiciona", "coloca", "colocar",
  "tem", "temos", "voces", "vcs", "ai", "ha", "tenho", "quanto", "custa", "preco", "valor", "disponivel", "estoque", "ver", "mais", "outro", "outra", "caixa", "caixas",
  "unidade", "unidades", "unid", "und", "por", "favor", "pf", "pfv", "oi", "ola", "bom", "dia", "tarde", "noite", "que", "qual", "quais", "si", "se", "o", "la", "ele", "ela",
  "vcs", "fazer", "montar", "novo", "nova", "iniciar", "obrigado", "obrigada", "valeu", "tinha", "algum", "alguma", "mandar", "manda", "entregar", "entrega", "levar", "leva", "quer", "vende", "vendem", "venda", "comprei", "carrinho", "ao", "aos", "ate",
]);

/** Significant tokens of a visitor message for catalog matching ("500 mg" -> "500mg"). */
export function productTokens(text: string): string[] {
  const glued = fold(text).replace(/\b(\d+(?:\s?[.,]\s?\d+)?)\s+(mg|mcg|g|ml|ui|%|comprimidos?|comp|caps?|capsulas?|gotas?)\b/g, "$1$2");
  // One-letter tokens are kept ("vitamina c" vs "vitamina d"); only stopwords are dropped.
  return [...new Set(glued.split(" ").filter((t) => t.length >= 1 && !STOPWORDS.has(t)))];
}

/** Product label text prepared for matching (same gluing as productTokens). */
export function foldProduct(text: string | null | undefined): string {
  return fold(text).replace(/\b(\d+(?:\s?[.,]\s?\d+)?)\s+(mg|mcg|g|ml|ui|%|comprimidos?|comp|caps?|capsulas?|gotas?)\b/g, "$1$2");
}

export function extractQty(text: string): number | null {
  const f = foldProduct(text);
  const words: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
  const unitWord = f.match(/\b(dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/);
  if (unitWord) return words[unitWord[1]];
  const n = f.match(/(?:^|\s)(\d{1,2})\s*x?(?=\s|$)/);
  if (n) return Number(n[1]);
  return null;
}

export function pickDigits(text: string): string {
  return String(text ?? "").replace(/\D/g, "");
}

export function isValidEmail(text: string): boolean {
  const t = text.trim();
  return t.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t);
}

export function titleCaseName(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w.length <= 2 && /^(da|de|do|das|dos|e)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

const NAME_STOP = new Set(["e", "mas", "quero", "queria", "preciso", "gostaria", "tenho", "estou", "to", "vim", "estava", "gostava", "posso", "pode", "poderia", "ola", "oi", "tudo", "que"]);

/**
 * "oi, meu nome é Marina", "me chamo Ana Souza, quero dipirona": the name and what is left of the message
 * (greeting and name clause removed). null when the text does not introduce the visitor.
 */
export function extractSelfName(text: string): { name: string; rest: string } | null {
  const raw = String(text ?? "").trim();
  const m = raw.match(/(?:meu nome (?:é|e)|me chamo|pode me chamar de|aqui (?:é|e) (?:o|a)|sou (?:o|a))\s+([A-Za-zÀ-ÿ'’-]+(?:\s+[A-Za-zÀ-ÿ'’-]+){0,3})/i);
  if (!m) return null;
  // "sou a/o" only with a capitalised name ("sou a Marina"), never "sou a favor".
  if (/^(?:aqui|sou)/i.test(m[0].trim()) && !/^[A-ZÀ-Ý]/.test(m[1])) return null;
  const words: string[] = [];
  for (const w of m[1].split(/\s+/)) {
    if (NAME_STOP.has(fold(w))) break;
    words.push(w);
  }
  if (words.length === 0 || words.length > 3) return null;
  const name = words.join(" ");
  if (fold(name).length < 2) return null;
  const rest = (raw.slice(0, m.index) + " " + raw.slice((m.index ?? 0) + m[0].length - (m[1].length - name.length)))
    .replace(/\b(?:oi|ol[aá]|bom dia|boa tarde|boa noite|tudo bem)\b[\s,!.?]*/gi, " ")
    .replace(/^[\s,.;!?-]+|[\s,.;!?-]+$/g, "")
    .replace(/\s+/g, " ");
  return { name, rest };
}
