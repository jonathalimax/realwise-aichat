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
      });
      return result.text;
    } catch {
      return substituted.replace(PLACEHOLDER_PATTERN, "");
    }
  }

  private async currentState(conversationId: string) {
    const conversation = await this.prisma.client.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException("Conversation not found");
    return conversation;
  }

  private async emit(businessId: string, niche: string, nodeId: string, params: Record<string, unknown>) {
    const flow = this.flowFor(niche);
    const node = flow.nodes[nodeId] ?? flow.nodes[flow.start];
    const message = await this.resolveMessage(businessId, node, params);
    const bubbles = [...(node.bubbles ?? []), ...flow.global_bubbles];
    return { nodeId: node.id, message, bubbles, input: node.input ?? null };
  }

  async start(businessId: string, conversationId: string) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException("Business not found");
    const flow = this.flowFor(business.niche);

    const conversation = await this.currentState(conversationId);
    const nodeId = conversation.flowNodeId ?? flow.start;
    const params = (conversation.flowParams as Record<string, unknown>) ?? {};

    if (!conversation.flowNodeId) {
      await this.prisma.client.conversation.update({
        where: { id: conversationId },
        data: { flowNodeId: flow.start, flowStack: [] },
      });
    }

    return this.emit(businessId, business.niche, nodeId, params);
  }

  async advance(businessId: string, conversationId: string, goto: string, bubbleParams: Record<string, unknown> = {}) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException("Business not found");

    const conversation = await this.currentState(conversationId);
    const currentNodeId = conversation.flowNodeId ?? this.flowFor(business.niche).start;
    const stack = [...conversation.flowStack];

    let targetNodeId: string;
    if (goto === "__back__") {
      targetNodeId = stack.pop() ?? this.flowFor(business.niche).start;
    } else {
      stack.push(currentNodeId);
      targetNodeId = goto;
    }

    const mergedParams = { ...(conversation.flowParams as Record<string, unknown>), ...bubbleParams };

    await this.prisma.client.conversation.update({
      where: { id: conversationId },
      data: { flowNodeId: targetNodeId, flowParams: mergedParams as any, flowStack: stack, fixedFlowTurns: { increment: 1 } },
    });

    return this.emit(businessId, business.niche, targetNodeId, mergedParams);
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
