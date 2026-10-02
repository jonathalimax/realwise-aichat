import { Injectable, NotFoundException } from "@nestjs/common";
import concessionariaFlow from "./flows/concessionaria.flow.json";
import imobiliariaFlow from "./flows/imobiliaria.flow.json";
import { PrismaService } from "../../prisma/prisma.service";
import { embedText } from "../../inference/embed-client";
import { generateFromGateway } from "../../inference/gateway-client";

interface FlowBubble {
  label: string;
  goto: string;
  params?: Record<string, unknown>;
}

interface FlowNode {
  id: string;
  message: string;
  bubbles?: FlowBubble[];
  input?: string;
  on_input?: string;
}

interface FlowDef {
  start: string;
  global_bubbles: FlowBubble[];
  nodes: Record<string, FlowNode>;
}

interface FlowSnapshot {
  nodeId: string;
  message: string;
  bubbles: FlowBubble[];
  input: string | null;
  params: Record<string, unknown>;
}

const MAX_FLOW_HISTORY = 25;

const FLOWS: Record<string, FlowDef> = {
  imobiliaria: imobiliariaFlow as unknown as FlowDef,
  concessionaria: concessionariaFlow as unknown as FlowDef,
};

const PLACEHOLDER_PATTERN = /\{[^{}]+\}/g;

@Injectable()
export class FlowService {
  constructor(private readonly prisma: PrismaService) {}

  private flowFor(niche: string): FlowDef {
    return FLOWS[niche] ?? FLOWS.imobiliaria;
  }

  private substitute(template: string, params: Record<string, unknown>): string {
    return template.replace(PLACEHOLDER_PATTERN, (match) => {
      const key = match.slice(1, -1);
      const value = params[key];
      return value === undefined || value === null ? match : String(value);
    });
  }

  // When the scripted message still has unresolved placeholders after substitution (e.g. it
  // depends on real inventory data this product doesn't structurally model), fall back to the
  // existing RAG+LLM pipeline to generate the actual descriptive text for that step — the node's
  // own bubbles are kept as the tappable options regardless.
  private async resolveMessage(businessId: string, node: FlowNode, params: Record<string, unknown>): Promise<string> {
    const substituted = this.substitute(node.message, params);
    if (!PLACEHOLDER_PATTERN.test(substituted)) return substituted;

    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) return substituted.replace(PLACEHOLDER_PATTERN, "");

    let chunkText = "";
    try {
      const embedding = await embedText(node.message);
      const rows = await this.prisma.client.$queryRawUnsafe<{ content: string }[]>(
        `SELECT content FROM "KnowledgeChunk"
         WHERE "businessId" = $1 AND embedding IS NOT NULL
         ORDER BY embedding <=> $2::vector
         LIMIT 5`,
        businessId,
        `[${embedding.join(",")}]`,
      );
      chunkText = rows.map((r) => r.content).join("\n\n").slice(0, 4000);
    } catch {
      chunkText = "";
    }

    const systemPrompt = [
      `Você é a Clara, atendente de IA da ${business.name}.`,
      "O fluxo de conversa pede a seguinte informação para o cliente, mas ela depende de dados reais do negócio que não estão totalmente estruturados:",
      `"${node.message}"`,
      "Responda de forma natural e curta (2-4 frases), usando SOMENTE os trechos de documentos abaixo. Se não houver dados suficientes, diga isso honestamente e sugira falar com um atendente — nunca invente preço, modelo ou disponibilidade.",
      chunkText ? `Trechos relevantes:\n${chunkText}` : "Nenhum documento relevante foi encontrado.",
    ].join("\n");

    try {
      const result = await generateFromGateway({
        purpose: "chat",
        businessId,
        systemPrompt,
        prompt: "Gere a resposta para o cliente.",
        // CPU inference on a RAG-grounded prompt routinely exceeds the default 25s used for short
        // chip/chat calls — this path was silently timing out and falling through to blank text.
        timeoutMs: 60000,
      });
      return result.text;
    } catch {
      return substituted.replace(PLACEHOLDER_PATTERN, "");
    }
  }

  // Derives region/bairro bubbles from what's actually mentioned in the business's ingested
  // documents instead of a hardcoded list — cached on Business since extraction is an LLM call.
  private async dynamicRegionBubbles(businessId: string): Promise<FlowBubble[]> {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) return [];

    const isFresh = business.cachedLocationsAt && Date.now() - business.cachedLocationsAt.getTime() < 12 * 3600 * 1000;
    if (isFresh && Array.isArray(business.cachedLocations)) {
      return (business.cachedLocations as string[]).map((name) => ({
        label: name,
        goto: "resultados",
        params: { regiao: name },
      }));
    }

    const chunks = await this.prisma.client.knowledgeChunk.findMany({
      where: { businessId },
      select: { content: true },
      take: 40,
    });
    const chunkText = chunks.map((c) => c.content).join("\n\n").slice(0, 6000);

    let names: string[] = [];
    if (chunkText) {
      try {
        const result = await generateFromGateway({
          purpose: "extraction",
          businessId,
          systemPrompt: [
            "Extraia os nomes de bairros ou regiões citados nos trechos de documentos abaixo.",
            "Responda apenas com um array JSON de até 6 strings, cada uma um bairro/região real mencionado no texto — nunca invente um nome que não apareça.",
            "Se nenhum bairro ou região for citado, responda com um array vazio [].",
            `Trechos:\n${chunkText}`,
          ].join("\n"),
          prompt: "Gere o array de bairros/regiões.",
          maxTokens: 150,
        });
        const parsed = JSON.parse(result.text.trim());
        if (Array.isArray(parsed)) names = parsed.filter((n) => typeof n === "string").slice(0, 6);
      } catch {
        names = [];
      }
    }

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { cachedLocations: names as any, cachedLocationsAt: new Date() },
    });

    return names.map((name) => ({ label: name, goto: "resultados", params: { regiao: name } }));
  }

  private async currentState(conversationId: string) {
    const conversation = await this.prisma.client.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException("Conversation not found");
    return conversation;
  }

  private async emit(businessId: string, niche: string, nodeId: string, params: Record<string, unknown>): Promise<FlowSnapshot> {
    const flow = this.flowFor(niche);
    const node = flow.nodes[nodeId] ?? flow.nodes[flow.start];
    const message = await this.resolveMessage(businessId, node, params);

    let bubbles: FlowBubble[];
    if (node.id === "busca_bairro") {
      // Only the location-agnostic bubbles from the script ("Perto de mim" / "Tanto faz") plus
      // real region names derived from the business's own documents — no hardcoded zone list.
      const locationAgnostic = (node.bubbles ?? []).filter(
        (b) => b.params?.regiao === "geo" || b.params?.regiao === "any",
      );
      const regions = await this.dynamicRegionBubbles(businessId);
      bubbles = [...regions, ...locationAgnostic, ...flow.global_bubbles];
    } else {
      bubbles = [...(node.bubbles ?? []), ...flow.global_bubbles];
    }

    return { nodeId: node.id, message, bubbles, input: node.input ?? null, params };
  }

  async start(businessId: string, conversationId: string) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException("Business not found");
    const flow = this.flowFor(business.niche);

    const conversation = await this.currentState(conversationId);
    const nodeId = conversation.flowNodeId ?? flow.start;
    const params = (conversation.flowParams as Record<string, unknown>) ?? {};

    const snapshot = await this.emit(businessId, business.niche, nodeId, params);

    if (!conversation.flowNodeId) {
      await this.prisma.client.conversation.update({
        where: { id: conversationId },
        data: { flowNodeId: flow.start, flowHistory: [], flowSnapshot: snapshot as any },
      });
    }

    return snapshot;
  }

  async advance(businessId: string, conversationId: string, goto: string, bubbleParams: Record<string, unknown> = {}) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException("Business not found");

    const conversation = await this.currentState(conversationId);
    const history = (conversation.flowHistory as unknown as FlowSnapshot[]) ?? [];

    // Back is pure local navigation: replay the exact snapshot that was already shown instead of
    // re-resolving the node, so it never triggers an LLM/RAG call or reads as "messaging Clara".
    if (goto === "__back__") {
      const previous = history[history.length - 1];
      if (!previous) {
        const flow = this.flowFor(business.niche);
        const snapshot = await this.emit(businessId, business.niche, flow.start, {});
        await this.prisma.client.conversation.update({
          where: { id: conversationId },
          data: { flowNodeId: flow.start, flowParams: {}, flowHistory: [], flowSnapshot: snapshot as any },
        });
        return snapshot;
      }

      await this.prisma.client.conversation.update({
        where: { id: conversationId },
        data: {
          flowNodeId: previous.nodeId,
          flowParams: previous.params as any,
          flowHistory: history.slice(0, -1) as any,
          flowSnapshot: previous as any,
        },
      });
      return previous;
    }

    const currentSnapshot = (conversation.flowSnapshot as unknown as FlowSnapshot) ?? null;
    const mergedParams = { ...(conversation.flowParams as Record<string, unknown>), ...bubbleParams };
    const nextSnapshot = await this.emit(businessId, business.niche, goto, mergedParams);

    const nextHistory = currentSnapshot ? [...history, currentSnapshot].slice(-MAX_FLOW_HISTORY) : history;

    await this.prisma.client.conversation.update({
      where: { id: conversationId },
      data: {
        flowNodeId: goto,
        flowParams: mergedParams as any,
        flowHistory: nextHistory as any,
        flowSnapshot: nextSnapshot as any,
        fixedFlowTurns: { increment: 1 },
      },
    });

    return nextSnapshot;
  }

  // Free-text input at a node with `on_input` routes to that target node instead of going to the
  // LLM — e.g. typing a CPF at "inquilino_id" advances straight to the "inquilino" node.
  async onInputTarget(businessId: string, conversationId: string): Promise<string | null> {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) return null;
    const conversation = await this.currentState(conversationId);
    const flow = this.flowFor(business.niche);
    const node = flow.nodes[conversation.flowNodeId ?? flow.start];
    return node?.on_input ?? null;
  }
}
