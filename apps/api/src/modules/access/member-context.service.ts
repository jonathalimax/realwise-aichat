import { Injectable, UnauthorizedException } from "@nestjs/common";
import { buildStarterPermissions, normalizePermissions, type NicheKey, type StarterRoleKey } from "@realwise/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { StarterRolesService } from "./starter-roles.service";
import type { MemberContext } from "./member-context";

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const MEMBER_INCLUDE = { role: true, business: { select: { id: true, niche: true } } } as const;

@Injectable()
export class MemberContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly starterRoles: StarterRolesService,
  ) {}

  /**
   * Resolve the acting member for a business session.
   * - New sessions carry memberId: that member must still exist, belong to the business and be active.
   * - Legacy sessions (owner phone login issued before the team feature) have no memberId: they act
   *   as the business's primary Owner (member whose phone matches, else the oldest active owner).
   */
  async resolve(claims: { businessId: string; memberId?: string; phoneNumber?: string }): Promise<MemberContext> {
    let member = claims.memberId
      ? await this.prisma.client.businessMember.findFirst({
          where: { id: claims.memberId, businessId: claims.businessId },
          include: MEMBER_INCLUDE,
        })
      : await this.findPrimaryOwner(claims.businessId, claims.phoneNumber);

    if (!claims.memberId && !member) {
      // Business created before roles existed and never backfilled: create starter roles + Owner now.
      const business = await this.prisma.client.business.findUnique({ where: { id: claims.businessId } });
      if (!business) throw new UnauthorizedException("Business not found");
      await this.starterRoles.ensureForBusiness(business);
      member = await this.findPrimaryOwner(claims.businessId, claims.phoneNumber);
    }
    if (!member || member.status !== "active") {
      throw new UnauthorizedException("Member inactive or removed");
    }

    if (!member.lastAccessAt || Date.now() - member.lastAccessAt.getTime() > TOUCH_INTERVAL_MS) {
      void this.prisma.client.businessMember
        .update({ where: { id: member.id }, data: { lastAccessAt: new Date() } })
        .catch(() => {});
    }
    return this.toContext(member);
  }

  private async findPrimaryOwner(businessId: string, phone?: string) {
    if (phone) {
      const byPhone = await this.prisma.client.businessMember.findFirst({
        where: { businessId, phone, role: { key: "owner" } },
        include: MEMBER_INCLUDE,
      });
      if (byPhone) return byPhone;
    }
    return this.prisma.client.businessMember.findFirst({
      where: { businessId, status: "active", role: { key: "owner" } },
      orderBy: { createdAt: "asc" },
      include: MEMBER_INCLUDE,
    });
  }

  toContext(member: {
    id: string;
    businessId: string;
    name: string;
    email: string | null;
    crf: string | null;
    roleId: string;
    role: { key: string | null; name: string; requiresCrf: boolean; ownDeliveriesOnly: boolean; permissions: unknown };
    business: { niche: string };
  }): MemberContext {
    const niche = member.business.niche as NicheKey;
    // The Owner role is immutable: always the canonical full grid, whatever is stored.
    const permissions =
      member.role.key === "owner"
        ? buildStarterPermissions(niche, "owner" as StarterRoleKey)
        : normalizePermissions(member.role.permissions);
    return {
      memberId: member.id,
      businessId: member.businessId,
      niche,
      name: member.name,
      email: member.email,
      crf: member.crf,
      roleId: member.roleId,
      roleKey: member.role.key,
      roleName: member.role.name,
      requiresCrf: member.role.requiresCrf,
      ownDeliveriesOnly: member.role.ownDeliveriesOnly,
      permissions,
    };
  }
}
