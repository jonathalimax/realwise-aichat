import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AdminService, PROBLEM_CASE_CATEGORIES } from "./admin.service";
import { AdminOnboardingService } from "./admin-onboarding.service";
import { AdminSessionGuard } from "../../common/guards/admin-session.guard";
import type { AdminSessionClaims } from "@realwise/auth";

const ALLOWED_DAYS = [7, 30, 90];

function parseDays(days?: string): number {
  const parsed = Number(days);
  return ALLOWED_DAYS.includes(parsed) ? parsed : 14;
}

@UseGuards(AdminSessionGuard)
@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly onboarding: AdminOnboardingService) {}

  @Post("businesses")
  createBusiness(@Body() body: { niche?: string; businessName?: string; ownerName?: string; email?: string; trialDays?: number }) {
    return this.onboarding.createBusiness(body);
  }

  @Post("tenants/:id/send-access")
  sendAccess(@Param("id") id: string, @Body("email") email?: string) {
    return this.onboarding.sendOwnerAccess(id, email);
  }

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

  @Get("tenants/:id/conversations")
  tenantConversations(@Param("id") id: string, @Query("limit") limit?: string, @Query("offset") offset?: string) {
    const parsedLimit = Number(limit);
    const parsedOffset = Number(offset);
    return this.admin.tenantConversations(
      id,
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50,
      Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0,
    );
  }

  @Get("tenants/:id/conversations/:conversationId")
  tenantConversationThread(@Param("id") id: string, @Param("conversationId") conversationId: string) {
    return this.admin.tenantConversationThread(id, conversationId);
  }

  @Patch("tenants/:id/confidence-threshold")
  overrideThreshold(@Param("id") id: string, @Body("threshold") threshold: number) {
    return this.admin.overrideConfidenceThreshold(id, threshold);
  }

  @Patch("tenants/:id/llm-budget")
  setLlmBudget(@Param("id") id: string, @Body("llmMonthlyBudgetUsdCents") llmMonthlyBudgetUsdCents: number | null) {
    return this.admin.setLlmBudgetOverride(id, llmMonthlyBudgetUsdCents);
  }

  @Patch("tenants/:id/conversational-mode")
  setConversationalMode(@Param("id") id: string, @Body("enabled") enabled: boolean) {
    return this.admin.setConversationalMode(id, enabled);
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

  @Get("metrics/conversation-cost")
  conversationCost(
    @Query("businessId") businessId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortOrder") sortOrder?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const parsedLimit = Number(limit);
    const parsedOffset = Number(offset);
    const parsedFrom = from ? new Date(from) : undefined;
    const parsedTo = to ? new Date(to) : undefined;
    return this.admin.conversationCostMetrics({
      businessId,
      from: parsedFrom && !Number.isNaN(parsedFrom.getTime()) ? parsedFrom : undefined,
      to: parsedTo && !Number.isNaN(parsedTo.getTime()) ? parsedTo : undefined,
      sortBy: sortBy === "cost" || sortBy === "tokens" || sortBy === "date" ? sortBy : undefined,
      sortOrder: sortOrder === "asc" || sortOrder === "desc" ? sortOrder : undefined,
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
      offset: Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : undefined,
    });
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

  // Managing who can log into the admin panel is a superadmin-only action — "support" admins can
  // see everything else above but must not be able to mint or remove other admin accounts.
  private requireSuperadmin(req: { admin?: AdminSessionClaims }) {
    if (req.admin?.role !== "superadmin") throw new ForbiddenException("Apenas superadmins podem gerenciar administradores.");
  }

  @Get("users")
  listAdminUsers(@Req() req: { admin?: AdminSessionClaims }) {
    this.requireSuperadmin(req);
    return this.admin.listAdminUsers();
  }

  @Post("users")
  createAdminUser(
    @Req() req: { admin?: AdminSessionClaims },
    @Body("email") email: string,
    @Body("name") name: string,
    @Body("role") role: string,
    @Body("password") password: string,
  ) {
    this.requireSuperadmin(req);
    return this.admin.createAdminUser(email, name, role, password);
  }

  @Delete("users/:id")
  deleteAdminUser(@Req() req: { admin?: AdminSessionClaims }, @Param("id") id: string) {
    this.requireSuperadmin(req);
    if (req.admin?.adminId === id) throw new BadRequestException("Você não pode remover sua própria conta de administrador.");
    return this.admin.deleteAdminUser(id);
  }
}
