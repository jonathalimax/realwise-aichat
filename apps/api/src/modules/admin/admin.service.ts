import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listTenants() {
    return this.prisma.client.business.findMany({
      orderBy: { createdAt: "desc" },
      include: { subscription: { include: { plan: true } } },
    });
  }

  async tenantDetail(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      include: { profile: true, subscription: { include: { plan: true } } },
    });
    if (!business) throw new NotFoundException("Tenant not found");
    return business;
  }

  async overrideConfidenceThreshold(businessId: string, _threshold: number) {
    // Threshold override stored on a per-business config in a future admin-config table.
    return this.prisma.client.business.findUnique({ where: { id: businessId } });
  }

  async suspendTenant(businessId: string) {
    return this.prisma.client.business.update({ where: { id: businessId }, data: { status: "suspended" } });
  }

  async globalMetrics() {
    const [tenantCount, liveTenantCount, conversationCount, leadCount] = await Promise.all([
      this.prisma.client.business.count(),
      this.prisma.client.business.count({ where: { status: "live" } }),
      this.prisma.client.conversation.count(),
      this.prisma.client.lead.count(),
    ]);
    return { tenantCount, liveTenantCount, conversationCount, leadCount };
  }
}
