import { ForbiddenException } from "@nestjs/common";

/**
 * 403 body shape (documented in docs/pharmacy/API.md):
 * { statusCode: 403, error: "Forbidden", code, message, section?, required? }
 */
export type AccessDeniedCode =
  | "PERMISSION_DENIED"
  | "CRF_REQUIRED"
  | "OWNER_PROTECTED"
  | "LAST_OWNER"
  | "OWN_DELIVERIES_ONLY";

export function accessDenied(code: AccessDeniedCode, message: string, extra: Record<string, unknown> = {}): ForbiddenException {
  return new ForbiddenException({ statusCode: 403, error: "Forbidden", code, message, ...extra });
}
