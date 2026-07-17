import { BadRequestException, createParamDecorator, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

export type RequestTenantContext = {
  tenantId: string;
  userId: string;
  role: string;
};

export function getTenantContextFromRequest(request: Request): RequestTenantContext {
  const tenantId = request.header("x-tenant-id");
  const userId = request.header("x-user-id");
  const role = request.header("x-role") ?? "OWNER";
  if (!tenantId) throw new BadRequestException({ code: "TENANT_REQUIRED", message: "Tenant obrigatório.", supportCode: "RW-AUTH-001" });
  if (!userId) throw new UnauthorizedException({ code: "SESSION_REQUIRED", message: "Sessão obrigatória.", supportCode: "RW-AUTH-002" });
  return { tenantId, userId, role };
}

export const TenantContext = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestTenantContext => {
  const request = ctx.switchToHttp().getRequest<Request>();
  return getTenantContextFromRequest(request);
});
