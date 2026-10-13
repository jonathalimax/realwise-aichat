import { Body, Controller, Get, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import type { CookieOptions, Request, Response } from "express";
import { AuthService } from "./auth.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentMember } from "../../common/decorators/current-business.decorator";
import { MemberAuthService } from "../access/member-auth.service";
import type { MemberContext } from "../access/member-context";
import { RateLimitGuard, AuthRateLimitGuard } from "../../common/guards/rate-limit.guard";

const SESSION_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 30 * 24 * 3600 * 1000,
};

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly memberAuth: MemberAuthService,
  ) {}

  /** Email + password login for business members (employees and owners who set credentials). */
  @UseGuards(AuthRateLimitGuard)
  @Post("member/login")
  async loginMember(
    @Body("email") email: string,
    @Body("password") password: string,
    @Body("businessSlug") businessSlug: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, ctx } = await this.memberAuth.loginWithPassword(email, password, businessSlug);
    res.cookie("rw_business_session", token, SESSION_COOKIE_OPTIONS);
    return this.memberAuth.buildMe(ctx);
  }

  /** The acting member with freshly resolved role + permissions (any authenticated member). */
  @UseGuards(BusinessSessionGuard)
  @Get("me")
  async me(@CurrentMember() member: MemberContext) {
    return this.memberAuth.buildMe(member);
  }

  /** Set / change the caller's own email + password (lets phone-login owners sign in by email). */
  @UseGuards(BusinessSessionGuard)
  @Put("me/credentials")
  async setCredentials(
    @CurrentMember() member: MemberContext,
    @Body("email") email: string,
    @Body("password") password: string,
    @Body("currentPassword") currentPassword?: string,
  ) {
    return this.memberAuth.setOwnCredentials(member, email, password, currentPassword);
  }

  @UseGuards(AuthRateLimitGuard)
  @Post("business/verify")
  async verifyBusiness(@Body("idToken") idToken: string, @Res({ passthrough: true }) res: Response) {
    const { token, business, isNew } = await this.auth.loginBusinessWithFirebaseToken(idToken);
    res.cookie("rw_business_session", token, SESSION_COOKIE_OPTIONS);
    return { business, isNew };
  }

  @UseGuards(AuthRateLimitGuard)
  @Post("admin/verify")
  async verifyAdmin(@Body("email") email: string, @Body("password") password: string, @Res({ passthrough: true }) res: Response) {
    const { token, admin } = await this.auth.loginAdminWithPassword(email, password);
    res.cookie("rw_admin_session", token, { ...SESSION_COOKIE_OPTIONS, maxAge: 12 * 3600 * 1000 });
    return { admin: { id: admin.id, name: admin.name, role: admin.role } };
  }

  @Post("business/logout")
  logoutBusiness(@Res({ passthrough: true }) res: Response) {
    res.clearCookie("rw_business_session", { path: "/" });
    return { ok: true };
  }

  @Post("admin/logout")
  logoutAdmin(@Res({ passthrough: true }) res: Response) {
    res.clearCookie("rw_admin_session", { path: "/" });
    return { ok: true };
  }

  @UseGuards(RateLimitGuard)
  @Post("visitor/identify")
  async identifyVisitor(
    @Body("businessSlug") businessSlug: string,
    @Body("name") name: string | undefined,
    @Body("phone") phone: string,
    @Body("email") email: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Find this browser's pre-identification anonymous token (set by VisitorSessionGuard on
    // the chat endpoints) so any conversation it already started can be re-linked to the lead
    // being created here — otherwise booking/sending right after identifying 403s, since the
    // conversation's ownership was recorded under the now-abandoned anonymous token.
    const anonCookieKey = Object.keys(req.cookies ?? {}).find((k) => k.startsWith("rw_visitor_anon_"));
    const anonToken = anonCookieKey ? req.cookies[anonCookieKey] : undefined;

    const { token, lead } = await this.auth.identifyVisitor(
      businessSlug,
      name,
      phone,
      req.ip ?? "",
      req.headers["user-agent"] ?? "",
      anonToken,
      email,
    );
    res.cookie("rw_visitor_session", token, SESSION_COOKIE_OPTIONS);
    return { lead: { id: lead.id } };
  }
}
