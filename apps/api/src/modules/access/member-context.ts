import type { NicheKey, ResolvedPermissions } from "@realwise/shared";

/** The authenticated business-side actor, resolved from the DB on every request (req.member). */
export interface MemberContext {
  memberId: string;
  businessId: string;
  niche: NicheKey;
  name: string;
  email: string | null;
  crf: string | null;
  roleId: string;
  /** owner | pharmacist | manager | attendant | courier for starter roles, null for custom roles. */
  roleKey: string | null;
  roleName: string;
  requiresCrf: boolean;
  ownDeliveriesOnly: boolean;
  permissions: ResolvedPermissions;
}
