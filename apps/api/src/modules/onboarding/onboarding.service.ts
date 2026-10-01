import { Injectable, NotFoundException } from "@nestjs/common";
import { nicheTemplates } from "@realwise/profile-schema";
import { PrismaService } from "../../prisma/prisma.service";
import { generateFromGateway } from "../../inference/gateway-client";

const ABSTENTION_MARKERS = [
  "não tenho essa informação",
  "não sei",
  "vou confirmar",
  "deixa eu confirmar",
  "não tenho certeza",
  "preciso verificar",
];

function looksLikeAbstention(text: string): boolean {
  const normalized = text.toLowerCase();
  return ABSTENTION_MARKERS.some((marker) => normalized.includes(marker));
}

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
      update: { data: data as any, fieldStatus: fieldStatus as any },
      create: {
        businessId,
        templateVersion: "0.1.0",
        data: data as any,
        fieldStatus: fieldStatus as any,
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

  private async runEvalQuestions(businessId: string, businessName: string, niche: string, profileSummary: string, evalQuestions: string[]): Promise<number> {
    if (evalQuestions.length === 0) return 0;

    const systemPrompt = [
      `Você é a Clara, a atendente de IA da ${businessName}, um negócio de ${niche === "imobiliaria" ? "locação imobiliária" : "concessionária de veículos"}.`,
      "Responda apenas com base nas informações abaixo. Se não souber, diga que vai confirmar com um atendente humano — nunca invente preço, prazo ou disponibilidade.",
      `Informações do negócio: ${profileSummary}`,
    ].join("\n");

    let grounded = 0;
    for (const question of evalQuestions) {
      try {
        const result = await generateFromGateway({
          purpose: "eval",
          businessId,
          systemPrompt,
          prompt: `Cliente: ${question}`,
          maxTokens: 200,
        });
        if (!looksLikeAbstention(result.text)) grounded++;
      } catch {
        // Inference unavailable — treat as not grounded rather than failing the whole recompute.
      }
    }
    return grounded / evalQuestions.length;
  }

  private async computeRealWorldFit(businessId: string): Promise<number | null> {
    const recentMessages = await this.prisma.client.message.findMany({
      where: { businessId, role: "assistant", answerSource: { in: ["rag", "abstained"] } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    if (recentMessages.length === 0) return null;
    const abstained = recentMessages.filter((m) => m.answerSource === "abstained").length;
    return 1 - abstained / recentMessages.length;
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

    const profileSummary = profile?.cachedSummary ?? JSON.stringify(data);
    const answerAbility = await this.runEvalQuestions(businessId, business.name, business.niche, profileSummary, template.evalQuestions);

    const realWorldFit = await this.computeRealWorldFit(businessId);
    const realWorldFitScore = realWorldFit ?? answerAbility; // no live traffic yet — fall back to the simulated score

    let score = Math.round(
      coverage * 30 + documentDepth * 20 + answerAbility * 100 * 0.2 + realWorldFitScore * 100 * 0.15 + 100 * 0.1 + ownerReview * 5,
    );
    if (filledRequired.length < requiredFields.length) {
      score = Math.min(score, 70);
    }
    score = Math.max(0, Math.min(100, score));

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        confidenceScore: score,
        confidenceBreakdown: { coverage, documentDepth, ownerReview, answerAbility, realWorldFit: realWorldFitScore } as any,
      },
    });

    return { score, coverage, documentDepth, ownerReview, answerAbility, realWorldFit: realWorldFitScore };
  }
}
