import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { SharedKnowledgeService } from "./shared-knowledge.service";
import { AdminSessionGuard } from "../../common/guards/admin-session.guard";

// Admin-only — same guard the rest of /admin uses. Shared knowledge is platform-curated content
// (rental/vehicle law, financing basics, documentation), never tenant-managed.
@UseGuards(AdminSessionGuard)
@Controller("admin/shared-knowledge")
export class SharedKnowledgeController {
  constructor(private readonly sharedKnowledge: SharedKnowledgeService) {}

  @Get("documents")
  listDocuments(@Query("niche") niche?: string) {
    return this.sharedKnowledge.listDocuments(niche);
  }

  @Post("documents/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }))
  uploadFile(
    @Body("niche") niche: string,
    @Body("title") title: string,
    @Body("sourceCitation") sourceCitation: string | undefined,
    @Body("version") version: string | undefined,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.sharedKnowledge.registerFileUpload(niche, title, file.originalname, file.mimetype, file.buffer, sourceCitation, version);
  }

  @Post("documents/text")
  registerText(
    @Body("niche") niche: string,
    @Body("title") title: string,
    @Body("filename") filename: string,
    @Body("content") content: string,
    @Body("sourceCitation") sourceCitation: string | undefined,
    @Body("version") version: string | undefined,
  ) {
    return this.sharedKnowledge.registerTextDocument(niche, title, filename, content, sourceCitation, version);
  }

  @Patch("documents/:id/deactivate")
  deactivate(@Param("id") id: string) {
    return this.sharedKnowledge.deactivateDocument(id);
  }

  @Patch("documents/:id/reactivate")
  reactivate(@Param("id") id: string) {
    return this.sharedKnowledge.reactivateDocument(id);
  }

  @Delete("documents/:id")
  deleteDocument(@Param("id") id: string) {
    return this.sharedKnowledge.deleteDocument(id);
  }
}
