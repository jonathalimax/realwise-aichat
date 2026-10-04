import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AdminService, PROBLEM_CASE_CATEGORIES } from "./admin.service";
import { AdminSessionGuard } from "../../common/guards/admin-session.guard";

const ALLOWED_DAYS = [7, 30, 90];

function parseDays(days?: string): number {
  const parsed = Number(days);
  return ALLOWED_DAYS.includes(parsed) ? parsed : 14;
}

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

  @Get("tenants/:id/knowledge")
  tenantKnowledge(@Param("id") id: string) {
    return this.admin.tenantKnowledge(id);
  }

  @Get("tenants/:id/documents/:documentId/markdown")
  tenantDocumentMarkdown(@Param("id") id: string, @Param("documentId") documentId: string) {
    return this.admin.tenantDocumentMarkdown(id, documentId);
  }

  @Get("tenants/:id/listings")
  tenantListings(@Param("id") id: string, @Query("limit") limit?: string, @Query("offset") offset?: string) {
    const parsedLimit = Number(limit);
    const parsedOffset = Number(offset);
    return this.admin.tenantListings(
      id,
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50,
      Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0,
    );
  }

  @Patch("tenants/:id/confidence-threshold")
  overrideThreshold(@Param("id") id: string, @Body("threshold") threshold: number) {
    return this.admin.overrideConfidenceThreshold(id, threshold);
  }

  @Post("tenants/:id/suspend")
  suspend(@Param("id") id: string) {
    return this.admin.suspendTenant(id);
  }

  @Patch("tenants/bulk-suspend")
  bulkSuspend(@Body("ids") ids: string[]) {
    return this.admin.bulkSuspendTenants(ids);
  }

  @Get("metrics")
  metrics() {
    return this.admin.globalMetrics();
  }

  @Get("metrics/timeseries")
  metricsTimeseries(@Query("days") days?: string) {
    return this.admin.metricsTimeseries(parseDays(days));
  }

  @Get("metrics/extraction-cost")
  extractionCost(@Query("days") days?: string) {
    return this.admin.extractionCostMetrics(parseDays(days));
  }

  @Get("metrics/confidence-distribution")
  confidenceDistribution() {
    return this.admin.confidenceDistribution();
  }

  @Get("conversations/insights")
  conversationInsights(@Query("days") days?: string) {
    return this.admin.conversationInsights(parseDays(days));
  }

  @Get("conversations/problem-cases")
  conversationProblemCases(
    @Query("days") days?: string,
    @Query("businessId") businessId?: string,
    @Query("category") category?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    if (category && !PROBLEM_CASE_CATEGORIES.includes(category as (typeof PROBLEM_CASE_CATEGORIES)[number])) {
      throw new BadRequestException("Categoria inválida");
    }
    const parsedLimit = Number(limit);
    const parsedOffset = Number(offset);
    return this.admin.conversationProblemCases({
      days: parseDays(days),
      businessId,
      category,
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 25,
      offset: Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0,
    });
  }

  @Get("platform-config")
  getPlatformConfig() {
    return this.admin.getPlatformConfig();
  }

  @Patch("platform-config")
  updatePlatformConfig(@Body("supportWhatsappNumber") supportWhatsappNumber: string) {
    return this.admin.updatePlatformConfig(supportWhatsappNumber);
  }

  // Gated behind AdminSessionGuard only (any logged-in admin, not just superadmin) — this codebase
  // has no existing superadmin-vs-support role-gating pattern on any other admin route to reuse.
  @Get("users")
  listAdminUsers() {
    return this.admin.listAdminUsers();
  }

  @Post("users")
  createAdminUser(
    @Body("email") email: string,
    @Body("name") name: string,
    @Body("role") role: string,
    @Body("password") password: string,
  ) {
    return this.admin.createAdminUser(email, name, role, password);
  }

  @Delete("users/:id")
  deleteAdminUser(@Param("id") id: string) {
    return this.admin.deleteAdminUser(id);
  }
}
