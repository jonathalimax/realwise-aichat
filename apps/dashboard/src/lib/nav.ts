// Navigation + route -> permission mapping. One definition per niche; the Sidebar shows only items the
// member can open, and AppShell renders "Sem acesso" for a route whose section is "none".
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Boxes,
  CalendarDays,
  CreditCard,
  FileText,
  Home,
  Inbox,
  LayoutList,
  MessageCircle,
  Package,
  Palette,
  ShieldCheck,
  Sparkles,
  Store,
  UserCircle,
  Users,
  Activity,
  Target,
} from "lucide-react";
import type { PermissionLevel, PermissionSection } from "@realwise/shared";
import type { Me } from "./pharmacy-api";

export type Niche = "imobiliaria" | "concessionaria" | "farmacia";
export type BadgeKey = "pedidos" | "atendimento";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  section: PermissionSection;
  level?: "view" | "edit"; // minimum level (default view)
  badge?: BadgeKey;
}
export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

const PHARMACY_NAV: NavGroup[] = [
  {
    label: "Operação",
    items: [
      { label: "Assistente", href: "/assistente", icon: Sparkles, section: "farmacia", level: "edit" },
      { label: "Início", href: "/inicio", icon: Home, section: "inicio" },
      { label: "Pedidos", href: "/pedidos", icon: Package, section: "pedidos", badge: "pedidos" },
      { label: "Atendimento farmacêutico", href: "/atendimento", icon: Activity, section: "atendimento", badge: "atendimento" },
      { label: "Catálogo", href: "/catalogo", icon: Boxes, section: "catalogo" },
      { label: "Clientes", href: "/clientes", icon: Users, section: "clientes" },
      { label: "Conversas", href: "/conversas", icon: MessageCircle, section: "conversas" },
      { label: "Análises", href: "/analises", icon: BarChart3, section: "analises" },
    ],
  },
  {
    label: "Gestão",
    items: [
      { label: "Farmácia", href: "/farmacia", icon: Store, section: "farmacia" },
      { label: "Equipe e acessos", href: "/equipe", icon: ShieldCheck, section: "equipe" },
      { label: "Plano e cobrança", href: "/plano", icon: CreditCard, section: "plano" },
    ],
  },
];

// Real estate / dealership keep their existing pages and routes; they are now permission-aware too.
const SALES_NAV: NavGroup[] = [
  {
    label: null,
    items: [
      { label: "Assistente", href: "/assistant", icon: Sparkles, section: "inicio" },
      { label: "Início", href: "/", icon: Home, section: "inicio" },
      { label: "Perfil", href: "/profile", icon: UserCircle, section: "configuracoes" },
      { label: "Interessados", href: "/leads", icon: Target, section: "leads" },
      { label: "Conversas", href: "/inbox", icon: Inbox, section: "conversas" },
      { label: "Agenda", href: "/agenda", icon: CalendarDays, section: "agenda" },
      { label: "Base de conhecimento", href: "/knowledge", icon: FileText, section: "conhecimento" },
      { label: "Anúncios", href: "/listings", icon: LayoutList, section: "imoveis" },
      { label: "Análises", href: "/analytics", icon: BarChart3, section: "analises" },
      { label: "Equipe e acessos", href: "/equipe", icon: ShieldCheck, section: "equipe" },
      { label: "Plano e cobrança", href: "/billing", icon: CreditCard, section: "plano" },
      { label: "Personalização", href: "/settings", icon: Palette, section: "configuracoes" },
    ],
  },
];

export function navFor(niche: Niche): NavGroup[] {
  return niche === "farmacia" ? PHARMACY_NAV : SALES_NAV;
}

const RANK: Record<PermissionLevel, number> = { none: 0, view: 1, edit: 2 };

export function levelOf(me: Me | null, section: PermissionSection): PermissionLevel {
  return me?.permissions?.[section] ?? "none";
}

export function can(me: Me | null, section: PermissionSection, level: "view" | "edit" = "view"): boolean {
  return RANK[levelOf(me, section)] >= RANK[level];
}

/** Items of a niche the member may open (everything when the member payload is not available, e.g. an older API). */
export function visibleNav(niche: Niche, me: Me | null): NavGroup[] {
  return navFor(niche)
    .map((g) => ({ ...g, items: g.items.filter((i) => !me || can(me, i.section, i.level ?? "view")) }))
    .filter((g) => g.items.length > 0);
}

/** Where a member lands after login / on "/": the first section they can open. */
export function homeFor(niche: Niche, me: Me | null): string {
  const first = visibleNav(niche, me)
    .flatMap((g) => g.items)
    .find((i) => i.href !== "/assistente" && i.href !== "/assistant");
  if (!first) return niche === "farmacia" ? "/sem-acesso" : "/";
  return first.href;
}

interface RouteRule {
  prefix: string;
  section: PermissionSection;
  level?: "view" | "edit";
  exact?: boolean;
}
// Most specific first.
const ROUTE_RULES: RouteRule[] = [
  { prefix: "/catalogo/importar", section: "importar" },
  { prefix: "/catalogo/classes", section: "classes" },
  { prefix: "/catalogo", section: "catalogo" },
  { prefix: "/inicio", section: "inicio" },
  { prefix: "/pedidos", section: "pedidos" },
  { prefix: "/atendimento", section: "atendimento" },
  { prefix: "/clientes", section: "clientes" },
  { prefix: "/conversas", section: "conversas" },
  { prefix: "/analises", section: "analises" },
  { prefix: "/farmacia", section: "farmacia" },
  { prefix: "/equipe", section: "equipe" },
  { prefix: "/plano", section: "plano" },
  { prefix: "/assistente", section: "farmacia", level: "edit" },
  // real estate / dealership
  { prefix: "/leads", section: "leads" },
  { prefix: "/inbox", section: "conversas" },
  { prefix: "/agenda", section: "agenda" },
  { prefix: "/knowledge", section: "conhecimento" },
  { prefix: "/listings", section: "imoveis" },
  { prefix: "/analytics", section: "analises" },
  { prefix: "/billing", section: "plano" },
  { prefix: "/profile", section: "configuracoes" },
  { prefix: "/settings", section: "configuracoes" },
  { prefix: "/", section: "inicio", exact: true },
];

export function requirementFor(pathname: string): { section: PermissionSection; level: "view" | "edit" } | null {
  for (const r of ROUTE_RULES) {
    const hit = r.exact ? pathname === r.prefix : pathname === r.prefix || pathname.startsWith(`${r.prefix}/`);
    if (hit) return { section: r.section, level: r.level ?? "view" };
  }
  return null;
}

/** Routes that render without the sidebar shell and without a session. */
export const PUBLIC_ROUTES = ["/login", "/convite", "/redefinir-senha"];
export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
