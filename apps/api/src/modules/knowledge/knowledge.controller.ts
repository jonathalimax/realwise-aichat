import { Body, Controller, Delete, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { KnowledgeService } from "./knowledge.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";

@UseGuards(BusinessSessionGuard, PermissionsGuard)
@RequirePermission("conhecimento", "view")
@Controller("knowledge")
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get("documents")
  listDocuments(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.knowledge.listDocuments(session.businessId);
  }

  @RequirePermission("conhecimento", "edit")
  @Post("documents/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }))
  uploadFile(@CurrentBusiness() session: BusinessSessionClaims, @UploadedFile() file: Express.Multer.File) {
    return this.knowledge.registerFileUpload(session.businessId, file.originalname, file.mimetype, file.buffer);
  }

  @RequirePermission("conhecimento", "edit")
  @Post("documents/text")
  registerText(
    @CurrentBusiness() session: BusinessSessionClaims,
    @Body("filename") filename: string,
    @Body("content") content: string,
  ) {
    return this.knowledge.registerTextDocument(session.businessId, filename, content);
  }

  @RequirePermission("conhecimento", "edit")
  @Delete("documents/:id")
  deleteDocument(@CurrentBusiness() session: BusinessSessionClaims, @Param("id") id: string) {
    return this.knowledge.deleteDocument(session.businessId, id);
  }

  @Get("unanswered")
  listUnanswered(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.knowledge.listUnanswered(session.businessId);
  }

  @RequirePermission("conhecimento", "edit")
  @Post("unanswered/:id/resolve")
  resolveUnanswered(
    @CurrentBusiness() session: BusinessSessionClaims,
    @Param("id") id: string,
    @Body("resolvedByProfileField") resolvedByProfileField: string,
  ) {
    return this.knowledge.resolveUnanswered(session.businessId, id, resolvedByProfileField);
  }
}
