import { Injectable } from "@nestjs/common";
import {
  STARTER_ROLE_DEFS,
  buildStarterPermissions,
  starterRoleKeysForNiche,
  type NicheKey,
} from "@realwise/shared";
import { PrismaService } from "../../prisma/prisma.service";

type BusinessLike = { id: string; niche: string; ownerName?: string | null; email?: string | null; phone?: string | null };

@Injectable()
export class StarterRolesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent. Creates the niche's starter roles (missing ones only) and, if the business has no
   * members at all, an active Owner member (phone login owner). Call on business creation and
   * whenever the niche changes (use syncForNiche then).
   */
  async ensureForBusiness(business: BusinessLike): Promise<void> {
    await this.createMissingRoles(business.id, business.niche as NicheKey);
    const memberCount = await this.prisma.client.businessMember.count({ where: { businessId: business.id } });
    if (memberCount > 0) return;
    const ownerRole = await this.prisma.client.role.findUniqueOrThrow({
      where: { businessId_key: { businessId: business.id, key: "owner" } },
    });
    try {
      await this.prisma.client.businessMember.create({
        data: {
          businessId: business.id,
          email: business.email?.trim().toLowerCase() || null,
          name: business.ownerName?.trim() || "Proprietário",
          phone: business.phone ?? null,
          roleId: ownerRole.id,
          status: "active",
        },
      });
    } catch (err: any) {
      if (err?.code !== "P2002") throw err; // concurrent creation: fine
    }
  }

  /** Roles only (no Owner member): used when an admin creates a business and invites the owner by email. */
  async ensureRolesOnly(businessId: string, niche: NicheKey): Promise<void> {
    await this.createMissingRoles(businessId, niche);
  }

  /** When a business changes niche: add missing starter roles and reset starter grids to the new niche. */
  async syncForNiche(businessId: string, niche: NicheKey): Promise<void> {
    await this.createMissingRoles(businessId, niche);
    for (const key of starterRoleKeysForNiche(niche)) {
      await this.prisma.client.role.updateMany({
        where: { businessId, key },
        data: { permissions: buildStarterPermissions(niche, key) as object },
      });
    }
  }

  private async createMissingRoles(businessId: string, niche: NicheKey): Promise<void> {
    await this.prisma.client.role.createMany({
      skipDuplicates: true,
      data: starterRoleKeysForNiche(niche).map((key) => {
        const d = STARTER_ROLE_DEFS[key];
        return {
          businessId,
          key,
          name: d.name,
          description: d.description,
          isStarter: true,
          requiresCrf: d.requiresCrf,
          ownDeliveriesOnly: d.ownDeliveriesOnly,
          permissions: buildStarterPermissions(niche, key) as object,
        };
      }),
    });
  }
}
