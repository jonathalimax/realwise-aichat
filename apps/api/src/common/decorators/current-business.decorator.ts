import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export const CurrentBusiness = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.business;
});

export const CurrentVisitor = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.visitor;
});
