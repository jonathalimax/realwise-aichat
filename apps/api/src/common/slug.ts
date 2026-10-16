import { BadRequestException } from "@nestjs/common";

/**
 * Slugs live at the root of the shared domain (`/<slug>/chat`, `/<slug>/pedido/<token>`), next to the fixed
 * routes below, so a business can never take one of them. Keep in sync with docs/pharmacy/URLS.md.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "api", "admin", "client", "clients", "cliente", "clientes",
  "imobiliaria", "imobiliarias", "farmacia", "farmacias", "concessionaria", "concessionarias", "estetica", "esteticas",
  "app", "apps", "chat", "pedido", "pedidos", "login", "logout", "signup", "cadastro", "entrar", "dashboard", "painel",
  "_c", "_next", "static", "assets", "public", "favicon.ico", "robots.txt", "sitemap.xml", "sw.js", "manifest.json",
  "health", "healthz", "status", "www", "mail", "docs", "blog", "preco", "precos", "planos", "contato", "sobre",
  "termos", "privacidade", "demo", "ajuda", "suporte", "webhook", "webhooks", "uploads", "icon.svg", "pending",
]);

export const SLUG_FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.trim().toLowerCase());
}

/** Returns a pt-BR error message, or null when the slug can be used. */
export function slugProblem(slug: unknown): string | null {
  if (typeof slug !== "string" || !slug.trim()) return "Informe o link de atendimento.";
  const s = slug.trim();
  if (s.length < 3 || s.length > 60) return "O link precisa ter entre 3 e 60 caracteres.";
  if (!SLUG_FORMAT.test(s)) return "Use apenas letras minúsculas sem acento, números e hífens (ex.: farmacia-boa-saude).";
  if (isReservedSlug(s)) return "Esse endereço é reservado pelo sistema. Escolha outro nome para o seu link.";
  return null;
}

export function assertValidSlug(slug: unknown): string {
  const problem = slugProblem(slug);
  if (problem) throw new BadRequestException(problem);
  return (slug as string).trim();
}
