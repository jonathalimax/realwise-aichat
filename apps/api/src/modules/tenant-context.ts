import { BadRequestException, createParamDecorator, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

export type RequestTenantContext = {
  tenantId: string;
  userId: string;
  role: string;
};

type TenantRequest = Request & { tenantContext?: RequestTenantContext };

export function getTenantContextFromRequest(request: TenantRequest): RequestTenantContext {
  if (request.tenantContext) return request.tenantContext;
  const tenantId = request.header("x-tenant-id");
  const userId = request.header("x-user-id");
  const role = request.header("x-role") ?? "OWNER";
  if (!tenantId) throw new BadRequestException({ code: "TENANT_REQUIRED", message: "Tenant obrigatório.", supportCode: "RW-AUTH-001" });
  if (!userId && process.env.DATABASE_URL) throw new UnauthorizedException({ code: "SESSION_REQUIRED", message: "Sessão obrigatória.", supportCode: "RW-AUTH-002" });
  return { tenantId, userId: userId ?? "demo-user", role };
}

export const TenantContext = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestTenantContext => {
  const request = ctx.switchToHttp().getRequest<TenantRequest>();
  return getTenantContextFromRequest(request);
});
