import { Body, Controller, Post, Res } from "@nestjs/common";
import type { CookieOptions, Response } from "express";
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

  @Post("visitor/identify")
  async identifyVisitor(
    @Body("businessSlug") businessSlug: string,
    @Body("name") name: string,
    @Body("phone") phone: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, lead } = await this.auth.identifyVisitor(businessSlug, name, phone);
    res.cookie("rw_visitor_session", token, SESSION_COOKIE_OPTIONS);
    return { lead };
  }
}
