import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export const CurrentBusiness = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.business;
});

export const CurrentVisitor = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.visitor;
});

/** The resolved MemberContext (role, permissions, crf) set by BusinessSessionGuard. */
export const CurrentMember = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.member as import("../../modules/access/member-context").MemberContext;
});
