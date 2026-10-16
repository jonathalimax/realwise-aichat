import { BadRequestException } from "@nestjs/common";
import { accessDenied } from "./access-errors";

// Pure team-management rules (PLAN.md decision 3). Wave-2 team/roles services call these before
// every write so the invariants live in one tested place.

export interface ActorLike {
  memberId: string;
  roleKey: string | null;
}
export interface TargetMemberLike {
  id: string;
  roleKey: string | null;
  status: "invited" | "active" | "disabled";
}

export function hasCrfOnFile(crf: string | null | undefined): boolean {
  return typeof crf === "string" && crf.trim().length >= 3;
}

/** Manager cannot grant the Owner role. Owners can grant anything. */
export function assertCanGrantRole(actor: ActorLike, newRoleKey: string | null): void {
  if (newRoleKey === "owner" && actor.roleKey !== "owner") {
    throw accessDenied("OWNER_PROTECTED", "Somente um proprietário pode conceder a função de proprietário.");
  }
}

/** Manager (any non-owner) cannot edit, disable, remove or change the role of an Owner. */
export function assertCanModifyMember(actor: ActorLike, target: TargetMemberLike): void {
  if (target.roleKey === "owner" && actor.roleKey !== "owner") {
    throw accessDenied("OWNER_PROTECTED", "Somente um proprietário pode alterar outro proprietário.");
  }
}

/**
 * The last active Owner cannot be removed, disabled or downgraded.
 * `activeOwnerCount` = active members whose role.key === "owner", INCLUDING the target.
 * `change` describes what is about to happen to the target.
 */
export function assertNotLastOwner(
  target: TargetMemberLike,
  activeOwnerCount: number,
  change: { type: "remove" | "disable" } | { type: "role"; newRoleKey: string | null },
): void {
  if (target.roleKey !== "owner" || target.status !== "active") return;
  const losesOwner = change.type === "role" ? change.newRoleKey !== "owner" : true;
  if (losesOwner && activeOwnerCount <= 1) {
    throw accessDenied("LAST_OWNER", "O último proprietário não pode ser removido, desativado ou rebaixado.");
  }
}

/** A member holding a requiresCrf role must have a CRF before becoming active. */
export function assertCrfForRole(role: { requiresCrf: boolean; name: string }, crf: string | null | undefined): void {
  if (role.requiresCrf && !hasCrfOnFile(crf)) {
    throw new BadRequestException({
      statusCode: 400,
      error: "Bad Request",
      code: "CRF_REQUIRED_FOR_ROLE",
      message: `A função "${role.name}" exige o número do CRF.`,
    });
  }
}

/** Starter roles are reference copies: they cannot be deleted; owner permissions cannot be edited. */
export function assertRoleEditable(role: { isStarter: boolean; key: string | null }, op: "update" | "delete"): void {
  if (role.key === "owner") {
    throw accessDenied("OWNER_PROTECTED", "A função Proprietário não pode ser alterada ou removida.");
  }
  if (role.isStarter && op === "delete") {
    throw new BadRequestException({ statusCode: 400, error: "Bad Request", code: "STARTER_ROLE", message: "Funções padrão não podem ser removidas. Duplique-a para personalizar." });
  }
  if (role.isStarter && op === "update") {
    throw new BadRequestException({ statusCode: 400, error: "Bad Request", code: "STARTER_ROLE", message: "Funções padrão não podem ser editadas. Duplique-a para personalizar." });
  }
}
