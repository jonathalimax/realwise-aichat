import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { AdminSessionGuard } from "../../common/guards/admin-session.guard";

@UseGuards(AdminSessionGuard)
@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("tenants")
  listTenants() {
    return this.admin.listTenants();
  }

  @Get("tenants/:id")
  tenantDetail(@Param("id") id: string) {
    return this.admin.tenantDetail(id);
  }

  @Patch("tenants/:id/confidence-threshold")
  overrideThreshold(@Param("id") id: string, @Body("threshold") threshold: number) {
    return this.admin.overrideConfidenceThreshold(id, threshold);
  }

  @Post("tenants/:id/suspend")
  suspend(@Param("id") id: string) {
    return this.admin.suspendTenant(id);
  }

  @Get("metrics")
  metrics() {
    return this.admin.globalMetrics();
  }
}
