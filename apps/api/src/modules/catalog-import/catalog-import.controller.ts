import { Body, Controller, Get, HttpCode, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { InternalTokenGuard } from "../../common/guards/internal-token.guard";
import { CurrentMember } from "../../common/decorators/current-business.decorator";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import type { MemberContext } from "../access/member-context";
import { CatalogImportService } from "./catalog-import.service";

@Controller("catalog-imports")
@UseGuards(BusinessSessionGuard, PermissionsGuard)
@RequirePermission("importar", "view")
export class CatalogImportController {
  constructor(private readonly imports: CatalogImportService) {}

  @RequirePermission("importar", "edit")
  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }))
  upload(@CurrentMember() m: MemberContext, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.imports.upload(m, file);
  }

  @Get()
  list(@CurrentMember() m: MemberContext, @Query("limit") limit?: string) {
    return this.imports.list(m.businessId, limit ? Number(limit) : 20);
  }

  @Get(":id")
  get(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.imports.get(m.businessId, id);
  }

  @RequirePermission("importar", "edit")
  @HttpCode(200)
  @Post(":id/mapping")
  mapping(@CurrentMember() m: MemberContext, @Param("id") id: string, @Body() body: { headerRow?: number; columns?: Array<{ sourceColumn: string; field: string }> }) {
    return this.imports.confirmMapping(m, id, body ?? {});
  }

  @Get(":id/class-proposals")
  classProposals(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.imports.classProposals(m.businessId, id);
  }

  @RequirePermission("importar", "edit")
  @Post(":id/apply")
  async apply(
    @CurrentMember() m: MemberContext,
    @Param("id") id: string,
    @Body() body: { stockAsOf?: string; stockUpToDateConfirmed?: boolean },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { dto, accepted } = await this.imports.apply(m, id, body ?? {});
    res.status(accepted ? 202 : 200);
    return dto;
  }
}

/** Called by apps/worker (queue `catalog-import`). */
@Controller("internal/businesses/:businessId/catalog-imports")
@UseGuards(InternalTokenGuard)
export class CatalogImportInternalController {
  constructor(private readonly imports: CatalogImportService) {}

  @Post(":id/map")
  async map(@Param("businessId") businessId: string, @Param("id") id: string) {
    await this.imports.runMap(businessId, id);
    return { ok: true };
  }

  @Post(":id/apply")
  async apply(@Param("businessId") businessId: string, @Param("id") id: string) {
    await this.imports.runApply(businessId, id);
    return { ok: true };
  }
}
