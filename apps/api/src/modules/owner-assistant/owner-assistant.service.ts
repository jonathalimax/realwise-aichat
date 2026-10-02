import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { generateFromGateway } from "../../inference/gateway-client";
import { embedText } from "../../inference/embed-client";
import { AnalyticsService } from "../analytics/analytics.service";
import { LeadsService } from "../leads/leads.service";

type OwnerMessage = { role: "owner" | "assistant"; content: string };

interface PendingProposal {
  fieldKey: string;
  proposedValue: string;
  reason: string;
}

interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
}

const TOOL_NAMES = ["getLeads", "getAnalytics", "searchKnowledgeBase", "proposeProfileEdit", "generateReport"] as const;

// Exactly the 5 tools the product spec allows — nothing else is callable from here.
const SYSTEM_PROMPT_HEADER = [
  "Você é o Assistente do Dono da RealWise — um assistente de IA restrito a ferramentas, dentro do painel do negócio.",
  "Você NUNCA responde com conhecimento geral solto: só responde perguntas sobre o próprio negócio do dono, usando uma das 5 ferramentas abaixo, ou uma resposta direta curta se nenhuma ferramenta for necessária.",
  "Ferramentas disponíveis (use o nome exato):",
  '- getLeads({ filter?: "hot"|"warm"|"cold" }) — lista leads do negócio, opcionalmente filtrados por faixa de pontuação.',
  '- getAnalytics({ metric?: "summary"|"timeseries", days?: number }) — métricas do negócio (conversas, leads, agendamentos).',
  '- searchKnowledgeBase({ query: string }) — busca trechos da base de conhecimento do próprio negócio.',
  '- proposeProfileEdit({ fieldKey: string, proposedValue: string, reason: string }) — NUNCA grava direto; apenas propõe uma mudança de campo do perfil para o dono confirmar.',
  '- generateReport({ period?: "7d"|"30d"|"90d" }) — gera um resumo textual combinando leads e analytics.',
  "Responda SEMPRE em JSON puro, sem markdown, no formato: {\"reply\": string, \"toolCall\": {\"tool\": string, \"input\": object} | null}.",
  "Use toolCall apenas quando uma das 5 ferramentas acima resolver a pergunta; caso contrário, toolCall deve ser null e reply deve conter a resposta direta.",
  "Nunca invente dados — toda informação concreta (números, leads, trechos) deve vir do resultado da ferramenta, não da sua memória.",
].join("\n");

@Injectable()
export class OwnerAssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly leads: LeadsService,
  ) {}

  private async getLeadsTool(businessId: string, input: { filter?: string }) {
    const all = await this.leads.listForBusiness(businessId);
    const filtered = input.filter ? all.filter((l) => l.scoreBand === input.filter) : all;
    return filtered.slice(0, 50).map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      scoreBand: l.scoreBand,
      commitmentScore: l.commitmentScore,
      lastSeenAt: l.lastSeenAt,
    }));
  }

  private async getAnalyticsTool(businessId: string, input: { metric?: string; days?: number }) {
    if (input.metric === "timeseries") {
      return this.analytics.timeseries(businessId, input.days ?? 14);
    }
    return this.analytics.dashboardSummary(businessId);
  }

  private async searchKnowledgeBaseTool(businessId: string, input: { query: string }) {
    try {
      const embedding = await embedText(input.query);
      const rows = await this.prisma.client.$queryRawUnsafe<{ content: string }[]>(
        `SELECT content FROM "KnowledgeChunk"
         WHERE "businessId" = $1 AND embedding IS NOT NULL
         ORDER BY embedding <=> $2::vector
         LIMIT 5`,
        businessId,
        `[${embedding.join(",")}]`,
      );
      return rows.map((r) => r.content);
    } catch {
      return [];
    }
  }

  // Propose-don't-write: returns a pending proposal only — the actual field write happens
  // later, via the existing patchProfileField-backed endpoint, after the owner explicitly confirms.
  private proposeProfileEditTool(input: { fieldKey?: string; proposedValue?: string; reason?: string }): PendingProposal | null {
    if (!input.fieldKey || input.proposedValue === undefined) return null;
    return {
      fieldKey: input.fieldKey,
      proposedValue: String(input.proposedValue),
      reason: input.reason ?? "",
    };
  }

  private async generateReportTool(businessId: string, input: { period?: string }) {
    const days = input.period === "90d" ? 90 : input.period === "7d" ? 7 : 30;
    const [summary, leadsList] = await Promise.all([
      this.analytics.dashboardSummary(businessId),
      this.leads.listForBusiness(businessId),
    ]);
    const hot = leadsList.filter((l) => l.scoreBand === "hot").length;
    const warm = leadsList.filter((l) => l.scoreBand === "warm").length;
    const cold = leadsList.filter((l) => l.scoreBand === "cold").length;
    return [
      `Relatório (últimos ${days} dias)`,
      `- Conversas (7d): ${summary.conversations7d}`,
      `- Leads no total: ${summary.leadsTotal} (quentes: ${hot}, mornos: ${warm}, frios: ${cold})`,
      `- Agendamentos no total: ${summary.appointmentsTotal}`,
      `- Links abertos (7d): ${summary.linkOpens7d}`,
    ].join("\n");
  }

  private async runTool(businessId: string, call: ToolCall): Promise<{ result: unknown; pendingProposal?: PendingProposal }> {
    switch (call.tool) {
      case "getLeads":
        return { result: await this.getLeadsTool(businessId, call.input as any) };
      case "getAnalytics":
        return { result: await this.getAnalyticsTool(businessId, call.input as any) };
      case "searchKnowledgeBase":
        return { result: await this.searchKnowledgeBaseTool(businessId, call.input as any) };
      case "proposeProfileEdit": {
        const proposal = this.proposeProfileEditTool(call.input as any);
        return { result: proposal, pendingProposal: proposal ?? undefined };
      }
      case "generateReport":
        return { result: await this.generateReportTool(businessId, call.input as any) };
      default:
        return { result: null };
    }
  }

  async ask(businessId: string, message: string, history: OwnerMessage[]) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException("Business not found");

    const conversation = history
      .map((m) => `${m.role === "owner" ? "Dono" : "Assistente"}: ${m.content}`)
      .join("\n");
    const prompt = `${conversation ? `${conversation}\n` : ""}Dono: ${message}\nAssistente:`;

    const systemPrompt = `${SYSTEM_PROMPT_HEADER}\n\nNegócio: ${business.name} (${business.niche}).`;

    let reply = "Não consegui processar isso agora — tenta de novo em instantes.";
    let toolCall: ToolCall | null = null;
    try {
      const result = await generateFromGateway({ purpose: "chat", businessId, systemPrompt, prompt, maxTokens: 400, timeoutMs: 60000 });
      const parsed = JSON.parse(result.text.trim());
      if (typeof parsed.reply === "string") reply = parsed.reply;
      if (parsed.toolCall && typeof parsed.toolCall.tool === "string" && (TOOL_NAMES as readonly string[]).includes(parsed.toolCall.tool)) {
        toolCall = { tool: parsed.toolCall.tool, input: parsed.toolCall.input ?? {} };
      }
    } catch {
      // keep the generic fallback reply; don't block on a parsing/inference hiccup
    }

    if (!toolCall) {
      return { reply, toolCalls: [] as ToolCall[] };
    }

    const { result, pendingProposal } = await this.runTool(businessId, toolCall);

    if (toolCall.tool === "proposeProfileEdit") {
      return {
        reply: pendingProposal
          ? `Proposta: alterar "${pendingProposal.fieldKey}" para "${pendingProposal.proposedValue}". ${pendingProposal.reason}`.trim()
          : "Não consegui montar a proposta de alteração — faltam dados do campo.",
        toolCalls: [toolCall],
        pendingProposal,
      };
    }

    // Second pass: ground the final reply in the real tool result, not the model's first guess.
    const groundingPrompt = `${prompt} ${reply}\n\nResultado da ferramenta ${toolCall.tool}: ${JSON.stringify(result)}\n\nResponda SEMPRE em JSON puro no formato {"reply": string} com a resposta final ao dono, usando SOMENTE os dados acima.`;
    try {
      const final = await generateFromGateway({
        purpose: "chat",
        businessId,
        systemPrompt,
        prompt: groundingPrompt,
        maxTokens: 400,
        timeoutMs: 60000,
      });
      const parsedFinal = JSON.parse(final.text.trim());
      if (typeof parsedFinal.reply === "string") reply = parsedFinal.reply;
    } catch {
      // keep first-pass reply if grounding call fails
    }

    return { reply, toolCalls: [toolCall], toolResult: result };
  }
}
