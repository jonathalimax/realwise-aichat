import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { commerceBlocked, loadOperationMode } from "../pharmacy-common/operation-mode";

/**
 * Blocks commerce-only pharmacy routes (products, catalog import, class review, orders, prescriptions)
 * when the pharmacy runs in attendance mode (chosen, or forced by its plan).
 * 403 body: { statusCode, error, code: "PLAN_FEATURE" | "MODE_ATTENDANCE", message, upgradeTo? }.
 * Use after BusinessSessionGuard (member) or VisitorSessionGuard (visitor, :businessId param).
 * Data is never deleted: after a downgrade it simply becomes unreachable.
 */
@Injectable()
export class CommerceModeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const businessId: string | undefined = req.member?.businessId ?? req.business?.businessId ?? req.params?.businessId;
    if (!businessId) throw new ForbiddenException({ statusCode: 403, error: "Forbidden", code: "PERMISSION_DENIED", message: "Sem acesso." });
    const info = await loadOperationMode(this.prisma.client, businessId);
    if (info.effective === "commerce") return true;
    const blocked = commerceBlocked(info);
    throw new ForbiddenException({
      statusCode: 403,
      error: "Forbidden",
      ...blocked,
      ...(info.upgradeToPlanCode ? { upgradeTo: info.upgradeToPlanCode } : {}),
    });
  }
}
