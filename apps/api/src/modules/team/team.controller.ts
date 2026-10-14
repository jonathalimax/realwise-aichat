import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { CookieOptions, Response } from "express";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { AuthRateLimitGuard } from "../../common/guards/rate-limit.guard";
import { CurrentMember } from "../../common/decorators/current-business.decorator";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import type { MemberContext } from "../access/member-context";
import { TeamService } from "./team.service";

export const SESSION_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 30 * 24 * 3600 * 1000,
};

@Controller("team")
export class TeamController {
  constructor(private readonly team: TeamService) {}

  // ----- members
  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission("equipe", "view")
  @Get("members")
  list(@CurrentMember() m: MemberContext, @Query("status") status?: string, @Query("q") q?: string) {
    return this.team.listMembers(m.businessId, { status, q });
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission("equipe", "edit")
  @Post("members/invite")
  invite(@CurrentMember() m: MemberContext, @Body() body: { email?: string; name?: string; roleId?: string }) {
    return this.team.invite(m, body ?? {});
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission("equipe", "edit")
  @Post("members/:id/resend-invite")
  resend(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.team.resendInvite(m, id);
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission("equipe", "edit")
  @Patch("members/:id")
  update(@CurrentMember() m: MemberContext, @Param("id") id: string, @Body() body: { name?: string; roleId?: string; crf?: string | null }) {
    return this.team.updateMember(m, id, body ?? {});
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission("equipe", "edit")
  @Post("members/:id/disable")
  disable(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.team.setDisabled(m, id, true);
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission("equipe", "edit")
  @Post("members/:id/enable")
  enable(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.team.setDisabled(m, id, false);
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission("equipe", "edit")
  @Delete("members/:id")
  remove(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.team.removeInvited(m, id);
  }

  // ----- public invite
  @UseGuards(AuthRateLimitGuard)
  @Get("invites/:token")
  getInvite(@Param("token") token: string) {
    return this.team.getInvite(token);
  }

  @UseGuards(AuthRateLimitGuard)
  @Post("invites/accept")
  async accept(@Body() body: { token?: string; name?: string; password?: string; crf?: string; acceptTerms?: boolean }, @Res({ passthrough: true }) res: Response) {
    const { token, me } = await this.team.acceptInvite(body ?? {});
    res.cookie("rw_business_session", token, SESSION_COOKIE_OPTIONS);
    return me;
  }

  // ----- roles
  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission("equipe", "view")
  @Get("roles")
  roles(@CurrentMember() m: MemberContext) {
    return this.team.listRoles(m.businessId);
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission("equipe", "view")
  @Get("roles/permission-sections")
  sections(@CurrentMember() m: MemberContext) {
    return this.team.permissionSections(m.niche);
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission("equipe", "edit")
  @Post("roles")
  createRole(@CurrentMember() m: MemberContext, @Body() body: any) {
    return this.team.createRole(m, body ?? {});
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission("equipe", "edit")
  @Patch("roles/:id")
  updateRole(@CurrentMember() m: MemberContext, @Param("id") id: string, @Body() body: any) {
    return this.team.updateRole(m, id, body ?? {});
  }

  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission("equipe", "edit")
  @Delete("roles/:id")
  deleteRole(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.team.deleteRole(m, id);
  }

  // ----- access log
  @UseGuards(BusinessSessionGuard, PermissionsGuard)
  @RequirePermission("equipe", "view")
  @Get("access-log")
  accessLog(
    @CurrentMember() m: MemberContext,
    @Query() q: { memberId?: string; category?: string; from?: string; to?: string; limit?: string; cursor?: string },
  ) {
    return this.team.listAccessLog(m, q);
  }
}

/** Password recovery for member (email + password) logins. Both routes are public. */
@Controller("auth/member")
export class MemberRecoveryController {
  constructor(private readonly team: TeamService) {}

  @UseGuards(AuthRateLimitGuard)
  @Post("forgot-password")
  async forgot(@Body() body: { email?: string; businessSlug?: string }) {
    await this.team.forgotPassword(body?.email ?? "", body?.businessSlug);
    return { ok: true };
  }

  @UseGuards(AuthRateLimitGuard)
  @Post("reset-password")
  async reset(@Body() body: { token?: string; password?: string }, @Res({ passthrough: true }) res: Response) {
    const { token, me } = await this.team.resetPassword(body ?? {});
    res.cookie("rw_business_session", token, SESSION_COOKIE_OPTIONS);
    return me;
  }
}
