import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { verifyBusinessSession } from "@realwise/auth";

@Injectable()
export class BusinessSessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = req.cookies?.rw_business_session;
    if (!token) throw new UnauthorizedException("Missing business session");
    try {
      const claims = await verifyBusinessSession(token);
      req.business = claims;
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired session");
    }
  }
}
