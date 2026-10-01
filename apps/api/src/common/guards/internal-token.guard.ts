import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "crypto";

const INTERNAL_TOKEN = process.env.INFERENCE_GATEWAY_TOKEN;
if (!INTERNAL_TOKEN || INTERNAL_TOKEN.length < 16) {
  throw new Error("INFERENCE_GATEWAY_TOKEN must be set to a strong value (>=16 chars) before starting this service");
}

function safeTokenMatch(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string" || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

@Injectable()
export class InternalTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!safeTokenMatch(req.headers["x-internal-token"], INTERNAL_TOKEN as string)) {
      throw new UnauthorizedException("Invalid internal token");
    }
    return true;
  }
}
