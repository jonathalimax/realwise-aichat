import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Request } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { hashToken } from "@realwise/auth";
import { memberships, sessions } from "@realwise/database";
import { DatabaseProvider } from "./database.provider";
import type { RequestTenantContext } from "./tenant-context";

export type AuthenticatedRequest = Request & {
  tenantContext?: RequestTenantContext;
};

@Injectable()
export class SessionTenantGuard implements CanActivate {
  constructor(private readonly databaseProvider: DatabaseProvider) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenantId = request.header("x-tenant-id");
    if (!tenantId) throw new BadRequestException({ code: "TENANT_REQUIRED", message: "Tenant obrigatório.", supportCode: "RW-AUTH-001" });

    const db = this.databaseProvider.optional();
    if (!db) {
      request.tenantContext = { tenantId, userId: request.header("x-user-id") ?? "demo-user", role: request.header("x-role") ?? "OWNER" };
      return true;
    }
    const token = readSessionCookie(request.header("cookie") ?? "");
    const [session] = await db.select().from(sessions).where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()))).limit(1);
    if (!session) throw new UnauthorizedException({ code: "SESSION_INVALID", message: "Sessão inválida.", supportCode: "RW-AUTH-004" });

    const [membership] = await db.select().from(memberships).where(and(eq(memberships.userId, session.userId), eq(memberships.tenantId, tenantId))).limit(1);
    if (!membership) throw new ForbiddenException({ code: "TENANT_FORBIDDEN", message: "Você não tem acesso a este tenant.", supportCode: "RW-AUTH-005" });

    request.tenantContext = { tenantId, userId: session.userId, role: membership.role };
    return true;
  }
}

function readSessionCookie(cookieHeader: string): string {
  const match = cookieHeader.match(/(?:^|; )rw_session=([^;]+)/);
  if (!match?.[1]) throw new UnauthorizedException({ code: "SESSION_REQUIRED", message: "Sessão obrigatória.", supportCode: "RW-AUTH-002" });
  return decodeURIComponent(match[1]);
}
