import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { KnowledgeService } from "./knowledge.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

@UseGuards(BusinessSessionGuard)
@Controller("knowledge")
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get("documents")
  listDocuments(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.knowledge.listDocuments(session.businessId);
  }

  @Post("documents")
  registerUpload(
    @CurrentBusiness() session: BusinessSessionClaims,
    @Body("filename") filename: string,
    @Body("mimeType") mimeType: string,
    @Body("sizeBytes") sizeBytes: number,
  ) {
    return this.knowledge.registerUpload(session.businessId, filename, mimeType, sizeBytes);
  }

  @Delete("documents/:id")
  deleteDocument(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string) {
    return this.knowledge.deleteDocument(session.businessId, id);
  }

  @Get("unanswered")
  listUnanswered(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.knowledge.listUnanswered(session.businessId);
  }

  @Post("unanswered/:id/resolve")
  resolveUnanswered(
    @CurrentBusiness() session: BusinessSessionClaims,
    @Param("id") id: string,
    @Body("resolvedByProfileField") resolvedByProfileField: string,
  ) {
    return this.knowledge.resolveUnanswered(session.businessId, id, resolvedByProfileField);
  }
}
