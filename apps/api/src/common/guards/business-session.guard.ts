import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { verifyBusinessSession } from "@realwise/auth";
import { MemberContextService } from "../../modules/access/member-context.service";

/**
 * Authenticates the business-side session cookie and attaches:
 *  - req.business: the raw JWT claims { businessId, phoneNumber, memberId?, ... } (unchanged shape,
 *    existing controllers keep using @CurrentBusiness()).
 *  - req.member: the freshly resolved MemberContext (role + permissions from the DB; a disabled or
 *    removed member is rejected here, so revocation is instant). Sessions issued before the team
 *    feature (no memberId) resolve to the business's primary Owner.
 * Pair with PermissionsGuard + @RequirePermission for authorization.
 */
@Injectable()
export class BusinessSessionGuard implements CanActivate {
  constructor(private readonly members: MemberContextService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = req.cookies?.rw_business_session;
    if (!token) throw new UnauthorizedException("Missing business session");
    let claims;
    try {
      claims = await verifyBusinessSession(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired session");
    }
    req.business = claims;
    req.member = await this.members.resolve(claims); // throws 401 when inactive/removed
    return true;
  }
}
