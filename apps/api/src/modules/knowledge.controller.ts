import { Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { chunkKnowledge } from "@realwise/knowledge";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { knowledgeSources } from "@realwise/database";
import { AuditService } from "./audit.service";
import { DatabaseProvider } from "./database.provider";
import { TenantContext, type RequestTenantContext } from "./tenant-context";
import { RequireRoles } from "./roles.decorator";
import { SessionTenantGuard } from "./session-tenant.guard";

const createKnowledgeSchema = z.object({
  title: z.string().min(1),
  kind: z.enum(["FAQ", "TEXT", "PDF", "WEBSITE", "BUSINESS_PROFILE"]),
  body: z.string().min(1),
});

@Controller("knowledge")
@UseGuards(SessionTenantGuard)
export class KnowledgeController {
  constructor(@Inject(DatabaseProvider) private readonly databaseProvider: DatabaseProvider, @Inject(AuditService) private readonly auditService: AuditService) {}

  @Get("sources")
  async sources(@TenantContext() context: RequestTenantContext) {
    const db = this.databaseProvider.optional();
    if (!db) {
      return [
        { id: "source-hours", tenantId: "demo-academia", title: "Horários de atendimento", kind: "BUSINESS_PROFILE", releaseState: "MOCK_VERIFIED", updatedAt: new Date().toISOString() },
        { id: "source-prices", tenantId: "demo-academia", title: "Planos e preços", kind: "FAQ", releaseState: "MOCK_VERIFIED", updatedAt: new Date().toISOString() },
      ];
    }
    return db.select().from(knowledgeSources).where(eq(knowledgeSources.tenantId, context.tenantId));
  }

  @Post("sources")
  @RequireRoles("OWNER", "ADMIN")
  async createSource(@TenantContext() context: RequestTenantContext, @Body() body: unknown) {
    const input = createKnowledgeSchema.parse(body);
    const db = this.databaseProvider.require();
    const [source] = await db.insert(knowledgeSources).values({ ...input, tenantId: context.tenantId, releaseState: "IMPLEMENTED_NOT_VERIFIED" }).returning();
    await this.auditService.record({ tenantId: context.tenantId, actorUserId: context.userId, action: "KNOWLEDGE_SOURCE_CREATED", targetType: "knowledge_source", targetId: source?.id, metadata: { kind: input.kind } });
    return { source, chunks: chunkKnowledge(input.body) };
  }

  @Post("preview-chunks")
  previewChunks(@Body() body: { text?: string }) {
    return { chunks: chunkKnowledge(body.text ?? "") };
  }
}
