import { Injectable, NotFoundException } from "@nestjs/common";
import { nicheTemplates } from "@realwise/profile-schema";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(businessId: string) {
    const profile = await this.prisma.client.businessProfile.findUnique({ where: { businessId } });
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException("Business not found");
    const template = nicheTemplates[business.niche];
    return { profile, template };
  }

  async patchProfileField(businessId: string, fieldKey: string, value: unknown, source: "document" | "interview" | "manual") {
    const existing = await this.prisma.client.businessProfile.findUnique({ where: { businessId } });
    const data = (existing?.data as Record<string, unknown>) ?? {};
    const fieldStatus = (existing?.fieldStatus as Record<string, unknown>) ?? {};

    data[fieldKey] = value;
    fieldStatus[fieldKey] = { source, approvedByOwner: false, updatedAt: new Date().toISOString() };

    return this.prisma.client.businessProfile.upsert({
      where: { businessId },
      update: { data, fieldStatus },
      create: {
        businessId,
        templateVersion: "0.1.0",
        data,
        fieldStatus,
      },
    });
  }

  async approveField(businessId: string, fieldKey: string) {
    const existing = await this.prisma.client.businessProfile.findUnique({ where: { businessId } });
    if (!existing) throw new NotFoundException("Profile not found");
    const fieldStatus = existing.fieldStatus as Record<string, any>;
    if (fieldStatus[fieldKey]) fieldStatus[fieldKey].approvedByOwner = true;
    return this.prisma.client.businessProfile.update({ where: { businessId }, data: { fieldStatus } });
  }

  async recomputeConfidence(businessId: string) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    const profile = await this.prisma.client.businessProfile.findUnique({ where: { businessId } });
    if (!business) throw new NotFoundException("Business not found");

    const template = nicheTemplates[business.niche];
    const data = (profile?.data as Record<string, unknown>) ?? {};
    const requiredFields = template.fields.filter((f) => f.weight === "required");
    const filledRequired = requiredFields.filter((f) => data[f.key] !== undefined && data[f.key] !== "");
    const coverage = requiredFields.length ? filledRequired.length / requiredFields.length : 0;

    const allFields = template.fields;
    const filledAll = allFields.filter((f) => data[f.key] !== undefined && data[f.key] !== "");
    const documentDepth = allFields.length ? filledAll.length / allFields.length : 0;

    const fieldStatus = (profile?.fieldStatus as Record<string, any>) ?? {};
    const approvedCount = Object.values(fieldStatus).filter((s: any) => s.approvedByOwner).length;
    const ownerReview = allFields.length ? approvedCount / allFields.length : 0;

    let score = Math.round(coverage * 30 + documentDepth * 20 + 60 * 0.2 + 0 * 0.15 + 100 * 0.1 + ownerReview * 5);
    if (filledRequired.length < requiredFields.length) {
      score = Math.min(score, 70);
    }
    score = Math.max(0, Math.min(100, score));

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        confidenceScore: score,
        confidenceBreakdown: { coverage, documentDepth, ownerReview } as any,
      },
    });

    return { score, coverage, documentDepth, ownerReview };
  }
}
