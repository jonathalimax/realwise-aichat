import { createHash, randomBytes } from "crypto";
import {
  CRF_SECTIONS,
  NICHE_SECTIONS,
  SECTION_LABELS,
  normalizePermissions,
  readOnlySectionsFor,
  type NicheKey,
  type PermissionSection,
} from "@realwise/shared";
import { MEMBER_STATUS_LABEL } from "../pharmacy-common/labels";
import { initialsOf } from "../pharmacy-common/format";

export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
export const RESET_TTL_MS = 3600 * 1000;

export function newToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: hashToken(raw) };
}
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Notes shown next to each row of the permission grid (prototype copy). */
const SECTION_NOTES: Partial<Record<PermissionSection, string>> = {
  receitas: "Validar exige CRF",
  atendimento: "Responder exige CRF",
  classes: "Confirmar classes exige CRF",
  clientes: "Dados de saúde ficam ocultos",
  conversas: "Somente leitura",
  farmacia: "Identidade legal só para proprietário",
  equipe: "Gerente não altera proprietários",
  pedidos: "Inclui entregas",
};

/** Row order of the permission grid in the prototype (pharmacy); sales niches keep the shared order. */
const GRID_ORDER: PermissionSection[] = ["inicio", "pedidos", "receitas", "atendimento", "conhecimento", "catalogo", "importar", "classes", "clientes", "conversas", "analises", "farmacia", "equipe", "plano"];

export function permissionSectionsFor(niche: NicheKey) {
  const ordered = [...NICHE_SECTIONS[niche]].sort((a, b) => {
    const ia = GRID_ORDER.indexOf(a);
    const ib = GRID_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const readOnly = new Set<string>(readOnlySectionsFor(niche));
  const crfOnly = new Set<string>(CRF_SECTIONS);
  return ordered.map((key) => ({
    key,
    label: SECTION_LABELS[key],
    ...(SECTION_NOTES[key] ? { note: SECTION_NOTES[key] } : {}),
    crfOnly: crfOnly.has(key),
    readOnly: readOnly.has(key),
  }));
}

type RoleRow = {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  isStarter: boolean;
  requiresCrf: boolean;
  ownDeliveriesOnly: boolean;
  permissions: unknown;
};

export function roleDto(role: RoleRow, memberCount: number) {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isStarter: role.isStarter,
    requiresCrf: role.requiresCrf,
    ownDeliveriesOnly: role.ownDeliveriesOnly,
    permissions: normalizePermissions(role.permissions),
    memberCount,
  };
}

export function memberDto(
  m: {
    id: string;
    name: string;
    email: string | null;
    crf: string | null;
    status: "invited" | "active" | "disabled";
    lastAccessAt: Date | null;
    createdAt: Date;
    role: { id: string; key: string | null; name: string; isStarter: boolean };
  },
  locked: boolean,
) {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    initials: initialsOf(m.name),
    crf: m.crf,
    status: m.status,
    statusLabel: MEMBER_STATUS_LABEL[m.status],
    role: { id: m.role.id, key: m.role.key, name: m.role.name, isStarter: m.role.isStarter },
    lastAccessAt: m.lastAccessAt ? m.lastAccessAt.toISOString() : null,
    invitedAt: m.createdAt.toISOString(),
    locked,
  };
}

/** The access log (who did what) is for owners and managers only, whatever other roles hold equipe:view. */
export function canViewAccessLog(roleKey: string | null): boolean {
  return roleKey === "owner" || roleKey === "manager";
}

export function roleChangeSummary(memberName: string, fromRole: string, toRole: string): string {
  return `Alterou ${memberName} de ${fromRole} para ${toRole}`;
}
