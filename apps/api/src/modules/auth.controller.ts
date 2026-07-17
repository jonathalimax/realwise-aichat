import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { roleSchema } from "@realwise/contracts";
import { z } from "zod";
import { AuthService } from "./auth.service";
import { SessionTenantGuard } from "./session-tenant.guard";
import { TenantContext, type RequestTenantContext } from "./tenant-context";

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

const inviteSchema = z.object({
  email: z.string().email(),
  role: roleSchema,
});

const acceptInviteSchema = z.object({
  inviteToken: z.string().min(32),
  name: z.string().min(1),
  password: z.string().min(12),
});

const verificationTokenSchema = z.object({ token: z.string().min(32) });
const passwordResetRequestSchema = z.object({ email: z.string().email() });
const passwordResetSchema = z.object({ resetToken: z.string().min(32), password: z.string().min(12) });

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

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

  @Post("invite")
  @UseGuards(SessionTenantGuard)
  async invite(@TenantContext() context: RequestTenantContext, @Body() body: unknown) {
    const input = inviteSchema.parse(body);
    return this.authService.createInvitation({ tenantId: context.tenantId, actorUserId: context.userId, ...input });
  }

  @Post("accept-invite")
  async acceptInvite(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.acceptInvitation(acceptInviteSchema.parse(body));
    setSessionCookie(response, result.sessionToken);
    return { user: result.user, tenantId: result.tenantId };
  }

  @Post("request-email-verification")
  @HttpCode(200)
  async requestEmailVerification(@Body() body: unknown) {
    const input = passwordResetRequestSchema.parse(body);
    return this.authService.requestEmailVerification(input.email);
  }

  @Post("verify-email")
  @HttpCode(200)
  async verifyEmail(@Body() body: unknown) {
    return this.authService.verifyEmail(verificationTokenSchema.parse(body).token);
  }

  @Post("request-password-reset")
  @HttpCode(200)
  async requestPasswordReset(@Body() body: unknown) {
    return this.authService.requestPasswordReset(passwordResetRequestSchema.parse(body).email);
  }

  @Post("reset-password")
  @HttpCode(200)
  async resetPassword(@Body() body: unknown) {
    return this.authService.resetPassword(passwordResetSchema.parse(body));
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
  if (!match?.[1]) throw new UnauthorizedException({ code: "SESSION_REQUIRED", message: "Sessão obrigatória.", supportCode: "RW-AUTH-002" });
  return decodeURIComponent(match[1]);
}
