import { Body, Controller, Post, Req, Res } from "@nestjs/common";
import type { CookieOptions, Request, Response } from "express";
import { AuthService } from "./auth.service";

const SESSION_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 30 * 24 * 3600 * 1000,
};

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("business/verify")
  async verifyBusiness(@Body("idToken") idToken: string, @Res({ passthrough: true }) res: Response) {
    const { token, business } = await this.auth.loginBusinessWithFirebaseToken(idToken);
    res.cookie("rw_business_session", token, SESSION_COOKIE_OPTIONS);
    return { business };
  }

  @Post("admin/verify")
  async verifyAdmin(@Body("idToken") idToken: string, @Res({ passthrough: true }) res: Response) {
    const { token, admin } = await this.auth.loginAdminWithFirebaseToken(idToken);
    res.cookie("rw_admin_session", token, { ...SESSION_COOKIE_OPTIONS, maxAge: 12 * 3600 * 1000 });
    return { admin: { id: admin.id, name: admin.name, role: admin.role } };
  }

  @Post("visitor/identify")
  async identifyVisitor(
    @Body("businessSlug") businessSlug: string,
    @Body("name") name: string,
    @Body("phone") phone: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, lead } = await this.auth.identifyVisitor(businessSlug, name, phone, req.ip ?? "", req.headers["user-agent"] ?? "");
    res.cookie("rw_visitor_session", token, SESSION_COOKIE_OPTIONS);
    return { lead };
  }
}
