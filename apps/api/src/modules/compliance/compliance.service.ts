import { Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class ComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  async recordConsent(businessId: string, leadId: string | undefined, phone: string, purposes: string[], ip: string, userAgent: string) {
    const phoneHash = createHash("sha256").update(phone).digest("hex");
    return this.prisma.client.consentRecord.create({
      data: {
        businessId,
        leadId,
        phoneHash,
        consentTextVersion: "2026-01",
        purposes,
        ipAddress: ip,
        userAgent,
      },
    });
  }

  async withdrawConsent(consentId: string, reason: string) {
    return this.prisma.client.consentRecord.update({
      where: { id: consentId },
      data: { withdrawnAt: new Date(), withdrawalReason: reason },
    });
  }

  async createDataSubjectRequest(businessId: string, leadId: string | undefined, type: "access" | "deletion" | "correction" | "portability") {
    return this.prisma.client.dataSubjectRequest.create({
      data: { businessId, leadId, type },
    });
  }

  async listOpenRequests(businessId: string) {
    return this.prisma.client.dataSubjectRequest.findMany({ where: { businessId, status: "open" } });
  }

  async fulfillRequest(businessId: string, requestId: string, notes: string) {
    const result = await this.prisma.client.dataSubjectRequest.updateMany({
      where: { id: requestId, businessId },
      data: { status: "fulfilled", fulfilledAt: new Date(), fulfillmentNotes: notes },
    });
    if (result.count === 0) throw new NotFoundException("Request not found");
    return result;
  }

  async deleteLeadData(businessId: string, leadId: string) {
    const lead = await this.prisma.client.lead.findFirst({ where: { id: leadId, businessId } });
    if (!lead) throw new NotFoundException("Lead not found");
    await this.prisma.client.conversation.deleteMany({ where: { businessId, leadId } });
    return this.prisma.client.lead.delete({ where: { id: lead.id } });
  }
}
