import { Injectable, NotFoundException } from "@nestjs/common";
import { nicheTemplates } from "@realwise/profile-schema";
import { PrismaService } from "../../prisma/prisma.service";
import { generateFromGateway } from "../../inference/gateway-client";

const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 1000;

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

    const result = await this.prisma.client.businessProfile.upsert({
      where: { businessId },
      update: { data: data as any, fieldStatus: fieldStatus as any },
      create: {
        businessId,
        templateVersion: "0.1.0",
        data: data as any,
        fieldStatus: fieldStatus as any,
      },
    });
    return result;
  }

  async updateCustomInstructions(businessId: string, customInstructions: string) {
    // Truncate rather than reject — friendlier UX, and the cap is a soft guardrail, not a hard contract.
    const truncated = customInstructions.slice(0, MAX_CUSTOM_INSTRUCTIONS_LENGTH);
    return this.prisma.client.businessProfile.upsert({
      where: { businessId },
      update: { customInstructions: truncated },
      create: { businessId, templateVersion: "0.1.0", data: {}, fieldStatus: {}, customInstructions: truncated },
    });
  }

  async approveField(businessId: string, fieldKey: string) {
    const existing = await this.prisma.client.businessProfile.findUnique({ where: { businessId } });
    if (!existing) throw new NotFoundException("Profile not found");
    const fieldStatus = existing.fieldStatus as Record<string, any>;
    if (fieldStatus[fieldKey]) fieldStatus[fieldKey].approvedByOwner = true;
    const result = await this.prisma.client.businessProfile.update({ where: { businessId }, data: { fieldStatus } });
    return result;
  }

  // Finds required/recommended/optional fields still missing, ordered so the most important
  // gaps get asked about first — same priority order used to weight the confidence score.
  private async findGaps(businessId: string) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException("Business not found");
    const profile = await this.prisma.client.businessProfile.findUnique({ where: { businessId } });
    const template = nicheTemplates[business.niche];
    const data = (profile?.data as Record<string, unknown>) ?? {};

    const weightOrder = { required: 0, recommended: 1, optional: 2 } as const;
    const gaps = template.fields
      .filter((f) => data[f.key] === undefined || data[f.key] === "")
      .sort((a, b) => weightOrder[a.weight] - weightOrder[b.weight]);

    return { business, template, data, gaps };
  }

  async interviewChat(businessId: string, history: { role: "owner" | "clara"; content: string }[]) {
    const { business, gaps } = await this.findGaps(businessId);

    if (gaps.length === 0) {
      return { reply: "Já cobrimos tudo que eu precisava saber! Pode revisar os campos abaixo e aprovar quando estiver tudo certo.", allDone: true, remainingGaps: 0 };
    }

    const documents = await this.prisma.client.knowledgeDocument.findMany({
      where: { businessId, status: "processed" },
      select: { extractedMarkdown: true },
      take: 5,
    });
    const documentContext = documents.map((d) => d.extractedMarkdown).filter(Boolean).join("\n\n").slice(0, 4000);

    const gapList = gaps.map((g) => `- ${g.key}: ${g.label} (${g.weight})`).join("\n");
    const conversation = history.map((m) => `${m.role === "owner" ? "Dono" : "Clara"}: ${m.content}`).join("\n");

    const systemPrompt = [
      `Você é a Clara, entrevistando o DONO da ${business.name} para completar o perfil do negócio (não é o cliente final).`,
      "Sua tarefa: perguntar, uma de cada vez, sobre os campos que ainda faltam preencher, na ordem dada.",
      "Se o conteúdo dos documentos abaixo já responder um campo, não pergunte de novo — apenas confirme e extraia o valor.",
      "Quando o dono responder uma pergunta, extraia um valor curto e estruturado para o campo perguntado.",
      "Responda SEMPRE em JSON puro, sem markdown, no formato: {\"reply\": string, \"fieldKey\": string|null, \"value\": string|null}.",
      "fieldKey/value só devem vir preenchidos quando a MENSAGEM MAIS RECENTE do dono responder a um campo — nunca invente valor.",
      "A pergunta em `reply` deve sempre nomear explicitamente o campo (use o label do campo, ex: \"Qual o horário de funcionamento?\") — nunca use um pronome vago como \"isso\"/\"isto\" sem dizer a que campo se refere.",
      `Campos que faltam (em ordem de prioridade):\n${gapList}`,
      documentContext ? `Conteúdo já extraído dos documentos (use para não perguntar o que já está aqui):\n${documentContext}` : "",
    ].join("\n\n");

    const prompt = conversation
      ? `${conversation}\nClara:`
      : "Inicie a entrevista perguntando sobre o primeiro campo da lista.";

    // Named fallback (not a vague "me conta mais sobre isso") in case the LLM call fails/times out.
    let reply = `Pode me contar sobre "${gaps[0].label}"?`;
    let fieldKey: string | null = null;
    let value: string | null = null;
    try {
      const result = await generateFromGateway({ purpose: "chat", businessId, systemPrompt, prompt, maxTokens: 300, timeoutMs: 60000 });
      const parsed = JSON.parse(result.text.trim());
      if (typeof parsed.reply === "string") reply = parsed.reply;
      if (typeof parsed.fieldKey === "string") fieldKey = parsed.fieldKey;
      if (typeof parsed.value === "string") value = parsed.value;
    } catch {
      // keep the generic fallback reply; don't block the conversation on a parsing/inference hiccup
    }

    if (fieldKey && value) {
      await this.patchProfileField(businessId, fieldKey, value, "interview");
    }

    const { gaps: remaining } = await this.findGaps(businessId);
    return { reply, allDone: remaining.length === 0, remainingGaps: remaining.length };
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

  // Freshness decays linearly from 100% (touched within 30d) to a 40% floor (180d+) — mitigates "decaimento do conhecimento".
  private async computeFreshness(businessId: string, profile: { updatedAt: Date } | null): Promise<number> {
    const latestDocument = await this.prisma.client.knowledgeDocument.findFirst({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const timestamps = [latestDocument?.createdAt, profile?.updatedAt].filter((d): d is Date => !!d);
    if (timestamps.length === 0) return 0;

    const mostRecent = new Date(Math.max(...timestamps.map((d) => d.getTime())));
    const ageDays = (Date.now() - mostRecent.getTime()) / (1000 * 60 * 60 * 24);

    const FULL_SCORE_DAYS = 30;
    const FLOOR_DAYS = 180;
    const FLOOR = 0.4;
    if (ageDays <= FULL_SCORE_DAYS) return 1;
    if (ageDays >= FLOOR_DAYS) return FLOOR;

    const progress = (ageDays - FULL_SCORE_DAYS) / (FLOOR_DAYS - FULL_SCORE_DAYS);
    return 1 - progress * (1 - FLOOR);
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

    const freshness = await this.computeFreshness(businessId, profile);

    let score = Math.round(
      coverage * 30 + documentDepth * 20 + answerAbility * 100 * 0.2 + realWorldFitScore * 100 * 0.15 + freshness * 100 * 0.1 + ownerReview * 5,
    );
    if (filledRequired.length < requiredFields.length) {
      score = Math.min(score, 70);
    }
    score = Math.max(0, Math.min(100, score));

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        confidenceScore: score,
        confidenceBreakdown: { coverage, documentDepth, ownerReview, answerAbility, realWorldFit: realWorldFitScore, freshness } as any,
      },
    });

    return { score, coverage, documentDepth, ownerReview, answerAbility, realWorldFit: realWorldFitScore, freshness };
  }
}
