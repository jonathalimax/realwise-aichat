import { SetMetadata } from "@nestjs/common";
import type { Role } from "@realwise/contracts";

export const REQUIRED_ROLES_KEY = "requiredRoles";
export const RequireRoles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES_KEY, roles);
