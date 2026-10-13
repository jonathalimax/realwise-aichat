import { SetMetadata } from "@nestjs/common";
import type { PermissionSection } from "@realwise/shared";

export const REQUIRE_PERMISSION_KEY = "rw:require-permission";
export const REQUIRE_CRF_KEY = "rw:require-crf";

export interface RequiredPermission {
  /** Any ONE of these sections granting `level` is enough (e.g. configuracoes for sales niches, farmacia for pharmacy). */
  sections: PermissionSection[];
  level: "view" | "edit";
}

/**
 * Declares the minimum permission a route needs. Method-level metadata wins over class-level.
 * Enforced by PermissionsGuard (always list it AFTER BusinessSessionGuard in @UseGuards).
 */
export const RequirePermission = (section: PermissionSection | PermissionSection[], level: "view" | "edit") =>
  SetMetadata(REQUIRE_PERMISSION_KEY, {
    sections: Array.isArray(section) ? section : [section],
    level,
  } satisfies RequiredPermission);

/**
 * The action is a pharmacist action: the member's role must have requiresCrf = true AND the member
 * must have a CRF number on file (prescription validation, class confirmation, handoff answers).
 */
export const RequireCrf = () => SetMetadata(REQUIRE_CRF_KEY, true);
