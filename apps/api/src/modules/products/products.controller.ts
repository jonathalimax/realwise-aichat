import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { RateLimitGuard } from "../../common/guards/rate-limit.guard";
import { CurrentMember } from "../../common/decorators/current-business.decorator";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequireCrf, RequirePermission } from "../access/permission.decorator";
import type { MemberContext } from "../access/member-context";
import { ProductsService } from "./products.service";
import { ClassReviewService } from "./class-review.service";

@Controller("products")
@UseGuards(BusinessSessionGuard, PermissionsGuard)
@RequirePermission("catalogo", "view")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@CurrentMember() m: MemberContext, @Query() q: Record<string, string | undefined>) {
    return this.products.list(m.businessId, q);
  }

  @Get(":id")
  get(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.products.get(m.businessId, id);
  }

  @RequirePermission("catalogo", "edit")
  @Post()
  create(@CurrentMember() m: MemberContext, @Body() body: Record<string, unknown>) {
    return this.products.create(m, body ?? {});
  }

  @RequirePermission("catalogo", "edit")
  @Patch(":id")
  update(@CurrentMember() m: MemberContext, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.products.update(m, id, body ?? {});
  }

  @RequirePermission("classes", "edit")
  @RequireCrf()
  @Post(":id/class")
  setClass(@CurrentMember() m: MemberContext, @Param("id") id: string, @Body("saleClass") saleClass: unknown) {
    return this.products.setClass(m, id, saleClass);
  }

  @RequirePermission("catalogo", "edit")
  @Post(":id/image")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 2 * 1024 * 1024 + 1 } }))
  uploadImage(@CurrentMember() m: MemberContext, @Param("id") id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.products.setImage(m, id, file);
  }

  @RequirePermission("catalogo", "edit")
  @Delete(":id/image")
  removeImage(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.products.removeImage(m, id);
  }
}

/** The ONLY way product images are served (the storage dir is never exposed statically). */
@Controller("public/products")
export class PublicProductImageController {
  constructor(private readonly products: ProductsService) {}

  @UseGuards(RateLimitGuard)
  @Get(":id/image")
  async image(@Param("id") id: string, @Res() res: Response) {
    const { data, mime } = await this.products.publicImage(id);
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(data);
  }
}

@Controller("catalog/class-review")
@UseGuards(BusinessSessionGuard, PermissionsGuard)
@RequirePermission("classes", "view")
export class ClassReviewController {
  constructor(private readonly review: ClassReviewService) {}

  @Get()
  overview(@CurrentMember() m: MemberContext) {
    return this.review.overview(m.businessId);
  }

  @Get("groups/:key/products")
  groupProducts(@CurrentMember() m: MemberContext, @Param("key") key: string, @Query() q: { limit?: string; cursor?: string }) {
    return this.review.groupProducts(m.businessId, key, q);
  }

  @RequirePermission("classes", "edit")
  @RequireCrf()
  @Post("groups/:key/confirm")
  confirm(@CurrentMember() m: MemberContext, @Param("key") key: string) {
    return this.review.confirmGroup(m, key);
  }
}
