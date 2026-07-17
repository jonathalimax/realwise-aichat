import { Body, Controller, Get, Headers, HttpCode, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { AuthService } from "./auth.service";

const bootstrapSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(12),
  tenantName: z.string().min(1),
  segment: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("bootstrap-owner")
  async bootstrapOwner(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.bootstrapOwner(bootstrapSchema.parse(body));
    setSessionCookie(response, result.sessionToken);
    return { user: result.user, tenant: result.tenant };
  }

  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.login(loginSchema.parse(body));
    setSessionCookie(response, result.sessionToken);
    return { user: result.user };
  }

  @Get("me")
  async me(@Headers("cookie") cookieHeader = "") {
    return this.authService.resolveSession(readSessionCookie(cookieHeader));
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Headers("cookie") cookieHeader = "", @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.logout(readSessionCookie(cookieHeader));
    response.clearCookie("rw_session");
    return result;
  }
}

function setSessionCookie(response: Response, token: string) {
  response.cookie("rw_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}

function readSessionCookie(cookieHeader: string): string {
  const match = cookieHeader.match(/(?:^|; )rw_session=([^;]+)/);
  if (!match?.[1]) throw new Error("Missing session cookie");
  return decodeURIComponent(match[1]);
}
