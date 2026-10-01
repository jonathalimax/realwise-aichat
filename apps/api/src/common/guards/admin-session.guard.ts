import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { verifyAdminSession } from "@realwise/auth";

@Injectable()
export class AdminSessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = req.cookies?.rw_admin_session;
    if (!token) throw new UnauthorizedException("Missing admin session");
    try {
      req.admin = await verifyAdminSession(token);
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired admin session");
    }
  }
}
