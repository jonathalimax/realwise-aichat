import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { verifyAdminSession } from "@realwise/auth";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = req.cookies?.rw_admin_session;
    if (!token) throw new UnauthorizedException("Missing admin session");
    let claims;
    try {
      claims = await verifyAdminSession(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired admin session");
    }
    // A removed admin's existing JWT would otherwise keep working until it naturally expires —
    // re-check the row still exists (and still has the claimed role) on every request.
    const stillValid = await this.prisma.client.adminUser.findFirst({
      where: { id: claims.adminId, role: claims.role },
      select: { id: true },
    });
    if (!stillValid) throw new UnauthorizedException("Admin account no longer exists");
    req.admin = claims;
    return true;
  }
}
