import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { KnowledgeService } from "./knowledge.service";
import { KnowledgeQaService } from "./knowledge-qa.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import { CurrentBusiness, CurrentMember } from "../../common/decorators/current-business.decorator";
import type { BusinessSessionClaims } from "@realwise/auth";
import type { MemberContext } from "../access/member-context";

@UseGuards(BusinessSessionGuard, PermissionsGuard)
@RequirePermission("conhecimento", "view")
@Controller("knowledge")
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService, private readonly qa: KnowledgeQaService) {}

  @Get("documents")
  listDocuments(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.knowledge.listDocuments(session.businessId);
  }

  @RequirePermission("conhecimento", "edit")
  @Post("documents/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }))
  uploadFile(@CurrentBusiness() session: BusinessSessionClaims, @CurrentMember() m: MemberContext, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException({ statusCode: 400, error: "Bad Request", code: "NO_FILE", message: "Envie um arquivo." });
    // A pharmacy only keeps text documents (a photo can carry a prescription or a customer's data).
    if (m?.niche === "farmacia" && !/\.(pdf|txt|md|docx)$/i.test(file.originalname)) {
      throw new BadRequestException({ statusCode: 400, error: "Bad Request", code: "FILE_TYPE", message: "Envie um PDF, DOCX ou TXT." });
    }
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

  // ---- Perguntas e respostas (pharmacy quick add), "Testar o Alex" and the open customer questions ----

  @Get("qa")
  listQa(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.qa.list(session.businessId);
  }

  @RequirePermission("conhecimento", "edit")
  @Post("qa")
  createQa(@CurrentMember() m: MemberContext, @Body() body: { question?: unknown; answer?: unknown }) {
    return this.qa.create(m, body ?? {});
  }

  @RequirePermission("conhecimento", "edit")
  @Patch("qa/:id")
  updateQa(@CurrentMember() m: MemberContext, @Param("id") id: string, @Body() body: { question?: unknown; answer?: unknown }) {
    return this.qa.update(m, id, body ?? {});
  }

  @RequirePermission("conhecimento", "edit")
  @Delete("qa/:id")
  deleteQa(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.qa.remove(m, id);
  }

  /** Dry run of the chat engine's retrieval: no conversation, message or handoff is ever created. */
  @Post("test")
  testAlex(@CurrentBusiness() session: BusinessSessionClaims, @Body("question") question: unknown) {
    return this.qa.testAlex(session.businessId, question);
  }

  @Get("open-questions")
  listOpenQuestions(@CurrentBusiness() session: BusinessSessionClaims) {
    return this.qa.listOpenQuestions(session.businessId);
  }
}
