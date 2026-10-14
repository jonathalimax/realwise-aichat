import { Body, Controller, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentMember } from "../../common/decorators/current-business.decorator";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import type { MemberContext } from "../access/member-context";
import { PharmacySettingsService } from "./pharmacy-settings.service";

@Controller("pharmacy/settings")
@UseGuards(BusinessSessionGuard, PermissionsGuard)
@RequirePermission("farmacia", "view")
export class PharmacySettingsController {
  constructor(private readonly settings: PharmacySettingsService) {}

  @Get()
  get(@CurrentMember() m: MemberContext) {
    return this.settings.dto(m.businessId);
  }

  @RequirePermission("farmacia", "edit")
  @Put()
  put(@CurrentMember() m: MemberContext, @Body() body: Record<string, unknown>) {
    // Accept both the bare settings object and { settings: {...} }.
    const patch = body && typeof body.settings === "object" && body.settings ? (body.settings as Record<string, unknown>) : body;
    return this.settings.update(m, patch ?? {});
  }

  @RequirePermission("farmacia", "edit")
  @Post("proposals/:fieldKey/confirm")
  confirm(@CurrentMember() m: MemberContext, @Param("fieldKey") fieldKey: string, @Body() body?: { values?: Record<string, unknown> }) {
    return this.settings.confirmProposal(m, fieldKey, body?.values);
  }

  @RequirePermission("farmacia", "edit")
  @Post("proposals/:fieldKey/dismiss")
  dismiss(@CurrentMember() m: MemberContext, @Param("fieldKey") fieldKey: string) {
    return this.settings.dismissProposal(m, fieldKey);
  }
}
