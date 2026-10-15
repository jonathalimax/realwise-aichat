// Team & access model shared by the API, dashboard and the DB backfill (single source of truth).
//
// One generic permission model for every niche: a Role carries `permissions`, a map
// { [section]: "none" | "view" | "edit" }. Sections are fixed keys; which ones apply to a business
// depends on its niche (NICHE_SECTIONS). Unknown / missing sections resolve to "none".

export type NicheKey = "imobiliaria" | "concessionaria" | "farmacia";

export const PERMISSION_SECTIONS = [
  // shared by every niche
  "inicio",
  "conversas",
  "analises",
  "equipe",
  "plano",
  // real estate / dealership
  "leads",
  "imoveis", // listings (properties or vehicles)
  "agenda",
  "conhecimento", // knowledge base / documents
  "configuracoes", // business settings, branding, profile
  // pharmacy
  "pedidos",
  "receitas",
  "atendimento",
  "catalogo",
  "importar",
  "classes",
  "clientes",
  "farmacia",
] as const;

export type PermissionSection = (typeof PERMISSION_SECTIONS)[number];
export type PermissionLevel = "none" | "view" | "edit";
export type PermissionMap = Partial<Record<PermissionSection, PermissionLevel>>;
export type ResolvedPermissions = Record<PermissionSection, PermissionLevel>;

export const SECTION_LABELS: Record<PermissionSection, string> = {
  inicio: "Início",
  conversas: "Conversas",
  analises: "Análises",
  equipe: "Equipe e acessos",
  plano: "Plano e cobrança",
  leads: "Leads",
  imoveis: "Imóveis / veículos",
  agenda: "Agenda",
  conhecimento: "Base de conhecimento",
  configuracoes: "Configurações",
  pedidos: "Pedidos",
  receitas: "Receitas (aba em Pedidos)",
  atendimento: "Atendimento farmacêutico",
  catalogo: "Catálogo",
  importar: "Importar planilha",
  classes: "Revisar classes",
  clientes: "Clientes",
  farmacia: "Farmácia (configurações)",
};

const SHARED_SECTIONS: PermissionSection[] = ["inicio", "conversas", "analises", "equipe", "plano"];

// Exhaustive on purpose: adding a niche without listing its sections is a compile error.
export const NICHE_SECTIONS: Record<NicheKey, readonly PermissionSection[]> = {
  imobiliaria: [...SHARED_SECTIONS, "leads", "imoveis", "agenda", "conhecimento", "configuracoes"],
  concessionaria: [...SHARED_SECTIONS, "leads", "imoveis", "agenda", "conhecimento", "configuracoes"],
  farmacia: [
    ...SHARED_SECTIONS,
    "pedidos",
    "receitas",
    "atendimento",
    "conhecimento",
    "catalogo",
    "importar",
    "classes",
    "clientes",
    "farmacia",
  ],
};

/** Sections where "edit" is only meaningful for a role flagged requiresCrf (pharmacist actions). */
// "atendimento" is deliberately NOT here: any member with Atendimento edit can handle plain availability checks
// (out of stock, product request); clinical handoffs (symptoms, Rx, controlled, urgent) are gated by CRF per handoff.
export const CRF_SECTIONS: readonly PermissionSection[] = ["receitas", "classes"];
/** Sections that can never be "edit" for a niche (read-only mirrors). Pharmacy conversations are read-only: staff answer through handoffs / orders. */
export function readOnlySectionsFor(niche: NicheKey): readonly PermissionSection[] {
  switch (niche) {
    case "farmacia":
      return ["conversas"];
    case "imobiliaria":
    case "concessionaria":
      return [];
    default: {
      const _never: never = niche;
      return _never;
    }
  }
}

export const STARTER_ROLE_KEYS = ["owner", "pharmacist", "manager", "attendant", "courier"] as const;
export type StarterRoleKey = (typeof STARTER_ROLE_KEYS)[number];

const L = { E: "edit", V: "view", N: "none" } as const;
type Grid = Partial<Record<PermissionSection, keyof typeof L>>;

// Pharmacy grid (prototype Main.dc.html section 4; column order Owner Pharmacist Manager Attendant Courier).
// "receitas": validating needs a CRF role; "atendimento": edit for staff, clinical handoffs additionally need a CRF. Courier edits only own deliveries (ownDeliveriesOnly).
const PHARMACY_GRID: Record<StarterRoleKey, Grid> = {
  owner:      { inicio: "V", pedidos: "E", receitas: "V", atendimento: "E", conhecimento: "E", catalogo: "E", importar: "E", classes: "V", clientes: "E", conversas: "V", analises: "V", farmacia: "E", equipe: "E", plano: "E" },
  pharmacist: { inicio: "V", pedidos: "E", receitas: "E", atendimento: "E", conhecimento: "E", catalogo: "E", importar: "E", classes: "E", clientes: "V", conversas: "V", analises: "V", farmacia: "V", equipe: "N", plano: "N" },
  manager:    { inicio: "V", pedidos: "E", receitas: "V", atendimento: "E", conhecimento: "E", catalogo: "E", importar: "E", classes: "N", clientes: "E", conversas: "V", analises: "V", farmacia: "E", equipe: "E", plano: "E" },
  attendant:  { inicio: "V", pedidos: "E", receitas: "V", atendimento: "E", conhecimento: "V", catalogo: "V", importar: "N", classes: "N", clientes: "V", conversas: "V", analises: "N", farmacia: "N", equipe: "N", plano: "N" },
  courier:    { inicio: "N", pedidos: "E", receitas: "N", atendimento: "N", conhecimento: "N", catalogo: "N", importar: "N", classes: "N", clientes: "N", conversas: "N", analises: "N", farmacia: "N", equipe: "N", plano: "N" },
};

// Real estate / dealership: same shape, mapped sensibly onto leads / listings / agenda / knowledge.
const SALES_GRID: Partial<Record<StarterRoleKey, Grid>> = {
  owner:     { inicio: "E", leads: "E", imoveis: "E", agenda: "E", conhecimento: "E", conversas: "E", analises: "V", configuracoes: "E", equipe: "E", plano: "E" },
  manager:   { inicio: "E", leads: "E", imoveis: "E", agenda: "E", conhecimento: "E", conversas: "E", analises: "V", configuracoes: "E", equipe: "E", plano: "E" },
  attendant: { inicio: "V", leads: "E", imoveis: "V", agenda: "E", conhecimento: "V", conversas: "E", analises: "N", configuracoes: "N", equipe: "N", plano: "N" },
};

export interface StarterRoleDef {
  key: StarterRoleKey;
  name: string;
  description: string;
  requiresCrf: boolean;
  ownDeliveriesOnly: boolean;
}

export const STARTER_ROLE_DEFS: Record<StarterRoleKey, StarterRoleDef> = {
  owner: { key: "owner", name: "Proprietário", description: "Acesso total. Sempre existe ao menos um.", requiresCrf: false, ownDeliveriesOnly: false },
  pharmacist: { key: "pharmacist", name: "Farmacêutico RT", description: "Valida receitas, confirma classes e responde atendimentos. Exige CRF.", requiresCrf: true, ownDeliveriesOnly: false },
  manager: { key: "manager", name: "Gerente", description: "Gerencia operação, catálogo, equipe e plano. Não altera proprietários.", requiresCrf: false, ownDeliveriesOnly: false },
  attendant: { key: "attendant", name: "Atendente", description: "Acompanha e atende pedidos, consulta catálogo e clientes.", requiresCrf: false, ownDeliveriesOnly: false },
  courier: { key: "courier", name: "Entregador", description: "Vê somente as próprias entregas.", requiresCrf: false, ownDeliveriesOnly: true },
};

/** Starter roles created for a business of this niche. Pharmacist / courier only exist for pharmacy. */
export function starterRoleKeysForNiche(niche: NicheKey): StarterRoleKey[] {
  switch (niche) {
    case "farmacia":
      return [...STARTER_ROLE_KEYS];
    case "imobiliaria":
    case "concessionaria":
      return ["owner", "manager", "attendant"];
    default: {
      const _never: never = niche;
      return _never;
    }
  }
}

export function emptyPermissions(): ResolvedPermissions {
  const out = {} as ResolvedPermissions;
  for (const s of PERMISSION_SECTIONS) out[s] = "none";
  return out;
}

/** Default permission map for a starter role in a niche (only the niche's sections; others are "none"). */
export function buildStarterPermissions(niche: NicheKey, key: StarterRoleKey): ResolvedPermissions {
  const grid: Grid | undefined = niche === "farmacia" ? PHARMACY_GRID[key] : SALES_GRID[key];
  const out = emptyPermissions();
  if (!grid) return out;
  for (const section of NICHE_SECTIONS[niche]) {
    const g = grid[section];
    if (g) out[section] = L[g];
  }
  return out;
}

/** Clamp an arbitrary JSON value into a complete, valid permission map. */
export function normalizePermissions(raw: unknown): ResolvedPermissions {
  const out = emptyPermissions();
  if (!raw || typeof raw !== "object") return out;
  for (const s of PERMISSION_SECTIONS) {
    const v = (raw as Record<string, unknown>)[s];
    if (v === "view" || v === "edit" || v === "none") {
      out[s] = v;
    }
  }
  return out;
}

const RANK: Record<PermissionLevel, number> = { none: 0, view: 1, edit: 2 };

/** true when the map grants at least `required` ("view" | "edit") on `section`. */
export function hasPermission(
  permissions: PermissionMap | null | undefined,
  section: PermissionSection,
  required: "view" | "edit",
): boolean {
  const level = permissions?.[section] ?? "none";
  return RANK[level] >= RANK[required];
}

/** Sections a member can open in the sidebar (level >= view). */
export function visibleSections(permissions: PermissionMap, niche: NicheKey): PermissionSection[] {
  return NICHE_SECTIONS[niche].filter((s) => hasPermission(permissions, s, "view"));
}

export interface RoleDefinitionInput {
  permissions: unknown;
  requiresCrf: boolean;
  niche: NicheKey;
}

/** Validation for creating / editing a custom role. Returns human-readable (pt-BR) errors; empty = ok. */
export function validateRoleDefinition(input: RoleDefinitionInput): string[] {
  const errors: string[] = [];
  const raw = (input.permissions && typeof input.permissions === "object" ? input.permissions : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(raw)) {
    if (!(PERMISSION_SECTIONS as readonly string[]).includes(k)) errors.push(`Seção desconhecida: ${k}`);
    else if (v !== "none" && v !== "view" && v !== "edit") errors.push(`Nível inválido para ${k}`);
  }
  const perms = normalizePermissions(raw);
  for (const s of CRF_SECTIONS) {
    if (perms[s] === "edit" && !input.requiresCrf) {
      errors.push(`"${SECTION_LABELS[s]}": editar exige uma função marcada como farmacêutico (CRF).`);
    }
  }
  if (readOnlySectionsFor(input.niche).some((s) => raw[s] === "edit")) errors.push("Conversas é somente leitura.");
  const allowed = new Set<string>(NICHE_SECTIONS[input.niche]);
  for (const s of PERMISSION_SECTIONS) {
    if (perms[s] !== "none" && !allowed.has(s)) errors.push(`A seção ${s} não existe neste tipo de negócio.`);
  }
  return errors;
}
