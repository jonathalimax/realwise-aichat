import { Global, Module } from "@nestjs/common";
import { CommerceModeGuard } from "./commerce-mode.guard";
import { AccessLogService } from "./access-log.service";
import { MemberAuthService } from "./member-auth.service";
import { MemberContextService } from "./member-context.service";
import { PermissionsGuard } from "./permissions.guard";
import { StarterRolesService } from "./starter-roles.service";

/**
 * Team & access foundation. Global so every module can inject AccessLogService /
 * MemberContextService and use PermissionsGuard without importing this module.
 */
@Global()
@Module({
  providers: [AccessLogService, MemberContextService, StarterRolesService, MemberAuthService, PermissionsGuard, CommerceModeGuard],
  exports: [AccessLogService, MemberContextService, StarterRolesService, MemberAuthService, PermissionsGuard, CommerceModeGuard],
})
export class AccessModule {}
