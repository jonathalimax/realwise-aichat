import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentMember } from "../../common/decorators/current-business.decorator";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import type { MemberContext } from "../access/member-context";
import { CustomersAdminService } from "./customers-admin.service";

@Controller("customers")
@UseGuards(BusinessSessionGuard, PermissionsGuard)
@RequirePermission("clientes", "view")
export class CustomersAdminController {
  constructor(private readonly customers: CustomersAdminService) {}

  @Get()
  list(@CurrentMember() m: MemberContext, @Query() q: { q?: string; limit?: string; cursor?: string }) {
    return this.customers.list(m.businessId, q);
  }

  @Get(":id")
  get(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.customers.get(m.businessId, id);
  }
}
