import { Injectable, NotFoundException } from "@nestjs/common";
import { buildWaMeLink, buildCustomerEscalationMessage, generateReferenceCode } from "@realwise/shared";
import concessionariaFlow from "./flows/concessionaria.flow.json";
import imobiliariaFlow from "./flows/imobiliaria.flow.json";
import { PrismaService } from "../../prisma/prisma.service";
import { LeadsService } from "../leads/leads.service";
import { generateFromGateway } from "../../inference/gateway-client";
import { retrieveRelevantChunks } from "./knowledge-retrieval";

// Scripted nodes that are supposed to hand the visitor off to a real human WhatsApp number —
// their flow-JSON message templates have placeholders ({numero}, {espera}) that nothing ever
// resolves, since the flow engine has no concept of "this node means: build a real wa.me link."
const WHATSAPP_HANDOFF_NODE_IDS = new Set(["handoff_whats", "handoff_whatsapp"]);

// LLM-parsed JSON isn't trusted input — only ever accept a genuine http(s) URL for a listing
// url/imageUrl, never a javascript:/data: scheme a malformed or adversarial model response could emit.
function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

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
  listings?: ListingItem[];
  whatsappUrl?: string | null;
}

export interface ListingItem {
  title: string;
  price?: string;
  description?: string;
  url?: string;
  imageUrl?: string;
}

// Node ids whose placeholder message is genuinely listing-shaped (a set of distinct real items,
// e.g. properties or vehicles) — only these get the structured JSON listings path; every other
// node with unresolved placeholders keeps the existing free-prose RAG fallback.
const LISTING_NODE_IDS = new Set(["resultados"]);

const MAX_FLOW_HISTORY = 25;

const STOPWORDS = new Set([
  "quero", "queria", "gostaria", "de", "da", "do", "um", "uma", "o", "a", "e",
  "que", "com", "para", "pra", "meu", "minha", "sobre", "ver", "já", "sou", "ser",
]);

// Small synonym set for the common top-level intents — NOT a general NLU system, just enough to
// catch "aluguel"/"comprar um carro" meaning the same as the bubble label's own keyword.
const SYNONYMS: Record<string, string[]> = {
  alugar: ["aluguel", "locacao", "locar"],
  comprar: ["compra", "comprar"],
  vender: ["venda", "anunciar", "anuncio"],
  inquilino: ["inquilino"],
  proprietario: ["proprietario", "anunciar"],
  atendente: ["atendente", "humano", "pessoa"],
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents (combining marks after NFD decomposition)
    .replace(/[^a-z0-9\s]/g, " ") // strip emoji/punctuation
    .replace(/\s+/g, " ")
    .trim();
}

function keywordsOf(label: string): string[] {
  return normalize(label)
    .split(" ")
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function expandWithSynonyms(keywords: string[]): Set<string> {
  const expanded = new Set<string>(keywords);
  for (const kw of keywords) {
    for (const variant of SYNONYMS[kw] ?? []) expanded.add(variant);
  }
  return expanded;
}

const FLOWS: Record<string, FlowDef> = {
  imobiliaria: imobiliariaFlow as unknown as FlowDef,
  concessionaria: concessionariaFlow as unknown as FlowDef,
};

const PLACEHOLDER_PATTERN = /\{[^{}]+\}/g;

// Prompts for the non-parametrized dynamic-bubble keys — shared between on-demand extraction
// (dynamicOptionBubbles) and proactive regeneration (regenerateFlowOptions) so they stay in sync.
const BRAND_PROMPT =
  "Extraia os nomes de MARCAS (fabricantes) de carros ou motos mencionadas no estoque descrito nos documentos abaixo — ex: Chevrolet, Fiat, Toyota, Hyundai são marcas. NUNCA inclua um nome de MODELO como se fosse marca (ex: Onix, Creta, HB20, Civic, Corolla, Strada, Compass são modelos, não marcas — se o texto só citar o modelo sem deixar claro o fabricante, não inclua nada para aquele item). Responda apenas com um array JSON de até 8 marcas reais mencionadas no texto — nunca invente uma marca que não apareça. Se nenhuma marca for citada, responda com um array vazio [].";
const VEHICLE_CATEGORY_PROMPT =
  "Extraia os tipos/categorias de veículos mencionados no estoque descrito nos documentos abaixo (ex: hatch, sedã, SUV, picape, moto, elétrico). Responda apenas com um array JSON de até 8 categorias reais mencionadas no texto — nunca invente uma categoria que não apareça. Se nenhuma for citada, responda com um array vazio [].";
const PROPERTY_TYPE_PROMPT =
  "Extraia os tipos de imóveis mencionados nos documentos abaixo (ex: apartamento, casa, terreno, comercial, chácara). Responda apenas com um array JSON de até 8 tipos reais mencionados no texto — nunca invente um tipo que não apareça. Se nenhum for citado, responda com um array vazio [].";

@Injectable()
export class FlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
  ) {}

  // Fire-and-forget, same pattern as ChatService's own recomputeLeadScore — scoring must never
  // slow down the visitor-facing flow response. Previously nothing in the scripted bubble-flow
  // path ever touched lead scoring at all (only free-text chat messages did), so a visitor who
  // only ever tapped bubbles — including through escalation/deep-interest nodes — never moved
  // their Lead's score no matter how committed their taps looked.
  private recomputeLeadScore(businessId: string, leadId?: string | null) {
    if (!leadId) return;
    this.leads.recomputeScoreForLead(businessId, leadId).catch(() => {});
  }

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
  // own bubbles are kept as the tappable options regardless. Listing-shaped nodes (e.g.
  // "resultados") instead ask for structured JSON items so the frontend can render real cards.
  private async resolveMessage(
    businessId: string,
    conversationId: string,
    node: FlowNode,
    params: Record<string, unknown>,
  ): Promise<{ message: string; listings?: ListingItem[]; whatsappUrl?: string | null }> {
    const substituted = this.substitute(node.message, params);

    if (WHATSAPP_HANDOFF_NODE_IDS.has(node.id)) {
      return this.resolveWhatsappHandoff(businessId, conversationId, substituted);
    }

    if (!PLACEHOLDER_PATTERN.test(substituted)) return { message: substituted };

    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) return { message: substituted.replace(PLACEHOLDER_PATTERN, "") };

    if (LISTING_NODE_IDS.has(node.id)) {
      // The literal node message ("Encontrei {n} imóveis para você") is a bad retrieval query —
      // it's generic UI copy, not a description of an actual listing, so it tends to rank
      // nav/footer/form chunks above the real listing cards. Build the query from the filters the
      // visitor actually picked instead, so retrieval is biased toward genuine inventory text.
      const listingQuery = this.listingQueryFor(business.niche, params);
      const listingChunks = await retrieveRelevantChunks(this.prisma, businessId, listingQuery);
      const listingChunkText = listingChunks.map((c) => c.content).join("\n\n").slice(0, 8000);
      const listings = await this.extractListings(businessId, business.name, listingChunkText);
      if (listings.length > 0) {
        return { message: "Encontrei algumas opções que podem te interessar 👇", listings };
      }
      // No genuine distinct items found in the retrieved text — fall through to the honest
      // prose fallback below instead of showing an empty/fabricated card list.
    }

    const chunks = await retrieveRelevantChunks(this.prisma, businessId, node.message);
    const chunkText = chunks.map((c) => c.content).join("\n\n").slice(0, 4000);

    const systemPrompt = [
      `Você é a Clara, atendente de IA da ${business.name}.`,
      "O fluxo de conversa pede a seguinte informação para o cliente, mas ela depende de dados reais do negócio que não estão totalmente estruturados:",
      `"${node.message}"`,
      "Responda de forma natural e curta (2-4 frases), usando SOMENTE os trechos de documentos abaixo. Se não houver dados suficientes, diga isso honestamente e sugira falar com um atendente — nunca invente preço, modelo ou disponibilidade.",
      "Regra especial para quantidades: nunca afirme um número específico de itens/resultados (ex: imóveis, carros, boletos) a menos que você consiga listar essa mesma quantidade de itens distintos, por nome/detalhe, a partir dos trechos abaixo. Se não conseguir confirmar o número exato pelo texto, use uma frase vaga e não numérica (ex: \"Encontrei algumas opções que podem te interessar\", \"Temos várias opções disponíveis\") em vez de inventar um número.",
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
      return { message: result.text };
    } catch {
      return { message: substituted.replace(PLACEHOLDER_PATTERN, "") };
    }
  }

  // The scripted "handoff_whats" node previously just rendered its message template with
  // unresolved {numero}/{espera} placeholders through the generic RAG fallback, which has no real
  // phone number to ground on — it either abstained awkwardly or invented one. This builds the
  // actual wa.me link from the business's configured routing number, marks the conversation as
  // genuinely escalated (so it shows up in admin's escalation stats, same as chat.service's own
  // escalate()), and returns whatsappUrl so the frontend can render a real tappable card.
  private async resolveWhatsappHandoff(
    businessId: string,
    conversationId: string,
    fallbackMessage: string,
  ): Promise<{ message: string; whatsappUrl: string | null }> {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    const routingNumber = await this.prisma.client.whatsappRoutingNumber.findFirst({
      where: { businessId, isActive: true },
      orderBy: { priority: "asc" },
    });

    if (!routingNumber || !business) {
      return { message: "No momento não consigo te conectar direto no WhatsApp, mas um atendente vai te procurar em breve.", whatsappUrl: null };
    }

    const referenceCode = generateReferenceCode();
    const waMessage = buildCustomerEscalationMessage(business.name, "Atendimento via chat", referenceCode);
    const whatsappUrl = buildWaMeLink(routingNumber.phone, waMessage);

    await this.prisma.client.conversation.update({
      where: { id: conversationId },
      data: { status: "escalated", escalatedAt: new Date(), escalationNumberId: routingNumber.id, referenceCode },
    });
    await this.prisma.client.message.create({
      data: { conversationId, businessId, role: "assistant", content: fallbackMessage.replace(PLACEHOLDER_PATTERN, "").trim(), answerSource: "escalation" },
    });

    return { message: "Toque no botão abaixo para continuar no WhatsApp com um atendente ✅", whatsappUrl };
  }

  // Turns the flow's accumulated filter params into a retrieval query that actually resembles
  // real listing text (e.g. "apartamento aluguel centro") instead of the generic node copy.
  private listingQueryFor(niche: string, params: Record<string, unknown>): string {
    const words: string[] = [niche === "concessionaria" ? "carro veículo" : "imóvel apartamento casa"];
    for (const key of ["tipo", "categoria", "marca", "modelo", "regiao", "modo"]) {
      const value = params[key];
      if (typeof value === "string" && value !== "any") words.push(value);
    }
    return words.join(" ");
  }

  // Asks the model for strictly-grounded structured listing items instead of prose — same
  // never-invent discipline as the rest of this file. Returns [] (not a fabricated placeholder)
  // whenever the retrieved text doesn't contain genuine distinct items.
  private async extractListings(businessId: string, businessName: string, chunkText: string): Promise<ListingItem[]> {
    if (!chunkText) return [];

    const systemPrompt = [
      `Você é a Clara, atendente de IA da ${businessName}.`,
      "Extraia itens de anúncio (imóveis ou veículos) genuinamente descritos nos trechos de documentos abaixo.",
      "Responda APENAS com um array JSON (até 6 itens), cada item no formato:",
      '{ "title": string, "price": string | omitido, "description": string | omitido, "url": string | omitido, "imageUrl": string | omitido }',
      "Regras: nunca invente um item, preço, url ou imagem que não apareça explicitamente no texto. Se um campo não aparecer no texto para aquele item, omita o campo (não invente um placeholder). 'url' só deve vir de um link real no formato [texto](url) ou de uma URL http(s) explícita no texto; 'imageUrl' só deve vir de uma anotação 'Foto: <url>' que esteja claramente DENTRO do bloco de texto daquele item específico — nunca reutilize uma 'Foto:' distante no texto ou que pareça ser logo/ícone do site (se não houver uma 'Foto:' inequivocamente associada àquele item, omita imageUrl). Se nenhum item real e distinto puder ser identificado, responda com um array vazio [].",
      `Trechos:\n${chunkText}`,
    ].join("\n");

    try {
      const result = await generateFromGateway({
        purpose: "extraction",
        businessId,
        systemPrompt,
        prompt: "Gere o array JSON de itens.",
        maxTokens: 1200,
        timeoutMs: 60000,
      });
      // The model sometimes wraps the array in a ```json fence despite the instruction not to —
      // strip that before parsing instead of discarding an otherwise-valid, well-grounded answer.
      const raw = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && typeof (item as any).title === "string")
        .slice(0, 6)
        .map((item) => ({
          title: String((item as any).title),
          ...(typeof (item as any).price === "string" ? { price: (item as any).price } : {}),
          ...(typeof (item as any).description === "string" ? { description: (item as any).description } : {}),
          ...(safeHttpUrl((item as any).url) ? { url: safeHttpUrl((item as any).url) } : {}),
          ...(safeHttpUrl((item as any).imageUrl) ? { imageUrl: safeHttpUrl((item as any).imageUrl) } : {}),
        }));
    } catch {
      return [];
    }
  }

  // Cheap keyword heuristic for free-text chat questions that are genuinely listing-shaped (e.g.
  // "quais imóveis vocês tem", "mostra os carros disponíveis") so the RAG chat path (ChatService)
  // can also surface structured cards instead of only a prose paragraph — NOT a general NLU
  // classifier, just enough to avoid running the extra extraction call on every unrelated question.
  isListingQuery(visitorText: string): boolean {
    const normalized = normalize(visitorText);
    const itemWords = ["imovel", "imoveis", "casa", "casas", "apartamento", "apartamentos", "carro", "carros", "veiculo", "veiculos"];
    const intentWords = ["disponivel", "disponiveis", "tem", "tem disponivel", "mostra", "mostre", "ver", "listar", "quais", "opcoes", "opcao"];
    const hasItemWord = itemWords.some((w) => normalized.includes(w));
    const hasIntentWord = intentWords.some((w) => normalized.includes(w));
    return hasItemWord && hasIntentWord;
  }

  // Public entry point for ChatService's free-text RAG path — same grounding discipline as the
  // scripted "resultados" node, driven off the same retrieved chunk text already being used to
  // build the prose answer.
  async extractListingsForQuery(businessId: string, chunkText: string): Promise<ListingItem[]> {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) return [];
    return this.extractListings(businessId, business.name, chunkText);
  }

  // Derives region/bairro bubbles from what's actually mentioned in the business's ingested
  // documents instead of a hardcoded list — cached on Business since extraction is an LLM call.
  private async dynamicRegionBubbles(businessId: string, force = false): Promise<FlowBubble[]> {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) return [];

    const isFresh = !force && business.cachedLocationsAt && Date.now() - business.cachedLocationsAt.getTime() < 12 * 3600 * 1000;
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

  // Generalized version of dynamicRegionBubbles for any other bubble list (brand/model/category)
  // that should reflect real values mentioned in the business's documents — cached per key on
  // Business.cachedFlowOptions since extraction is an LLM call.
  private async extractOptions(businessId: string, cacheKey: string, systemPrompt: string, force = false): Promise<string[]> {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) return [];

    const cache = (business.cachedFlowOptions as Record<string, { values: string[]; at: string }> | null) ?? {};
    const entry = cache[cacheKey];
    const isFresh = !force && entry && Date.now() - new Date(entry.at).getTime() < 12 * 3600 * 1000;
    if (isFresh) return entry.values;

    const chunks = await this.prisma.client.knowledgeChunk.findMany({
      where: { businessId },
      select: { content: true },
      take: 40,
    });
    const chunkText = chunks.map((c) => c.content).join("\n\n").slice(0, 6000);

    let values: string[] = [];
    if (chunkText) {
      try {
        const result = await generateFromGateway({
          purpose: "extraction",
          businessId,
          systemPrompt: `${systemPrompt}\nTrechos:\n${chunkText}`,
          prompt: "Gere o array.",
          maxTokens: 150,
        });
        const parsed = JSON.parse(result.text.trim());
        if (Array.isArray(parsed)) values = parsed.filter((n) => typeof n === "string").slice(0, 8);
      } catch {
        values = [];
      }
    }

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { cachedFlowOptions: { ...cache, [cacheKey]: { values, at: new Date().toISOString() } } as any },
    });

    return values;
  }

  // Dynamic bubbles for car brand / model / category (vehicle or property type) nodes, mirroring
  // dynamicRegionBubbles but driven by extractOptions since there are several such lists.
  private async dynamicOptionBubbles(
    businessId: string,
    nodeId: string,
    params: Record<string, unknown>,
  ): Promise<FlowBubble[] | null> {
    switch (nodeId) {
      case "busca_marca":
      case "busca_marca_mais":
      case "troca_marca": {
        const brands = await this.extractOptions(businessId, "marca", BRAND_PROMPT);
        const slice = nodeId === "busca_marca_mais" ? brands.slice(4) : brands.slice(0, 4);
        const goto = nodeId === "troca_marca" ? "troca_modelo" : "busca_modelo";
        // troca_marca previously passed no params at all, so the brand tapped here never reached
        // troca_modelo — every trade-in model lookup silently fell back to marca="any" and came
        // back empty. It needs the same "marca" param key as busca_marca.
        return slice.map((name) => ({
          label: name,
          goto,
          params: { marca: name },
        }));
      }
      case "busca_modelo":
      case "troca_modelo": {
        const marca = (params.marca as string) ?? "any";
        const models = await this.extractOptions(
          businessId,
          `modelo:${marca}`,
          `Extraia os nomes de modelos da marca "${marca}" mencionados nos documentos abaixo. Responda apenas com um array JSON de até 6 modelos reais mencionados no texto — nunca invente um modelo que não apareça. Se nenhum modelo for citado, responda com um array vazio [].`,
        );
        const goto = nodeId === "troca_modelo" ? "troca_ano" : "busca_preco";
        return models.map((name) => ({
          label: name,
          goto,
          params: { modelo: name },
        }));
      }
      case "busca_categoria": {
        const categories = await this.extractOptions(businessId, "categoria_veiculo", VEHICLE_CATEGORY_PROMPT);
        return categories.map((name) => ({ label: name, goto: "busca_marca", params: { categoria: name } }));
      }
      case "busca_tipo": {
        const types = await this.extractOptions(businessId, "categoria_imovel", PROPERTY_TYPE_PROMPT);
        return types.map((name) => ({ label: name, goto: "busca_preco", params: { tipo: name } }));
      }
      default:
        return null;
    }
  }

  // Proactively refreshes the dynamic-bubble caches right after documents/website content change,
  // instead of waiting for a visitor to hit a stale cache entry — called from the worker alongside
  // the existing chip/confidence regeneration triggers on document-ingestion and website-sync.
  // `modelo` is skipped here since it's parametrized per brand (no fixed key to precompute); it still
  // regenerates lazily on-demand the next time a visitor picks a brand.
  async regenerateFlowOptions(businessId: string): Promise<void> {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) return;

    await this.dynamicRegionBubbles(businessId, true);
    if (business.niche === "concessionaria") {
      await this.extractOptions(businessId, "marca", BRAND_PROMPT, true);
      await this.extractOptions(businessId, "categoria_veiculo", VEHICLE_CATEGORY_PROMPT, true);
    } else {
      await this.extractOptions(businessId, "categoria_imovel", PROPERTY_TYPE_PROMPT, true);
    }
  }

  // True for bubbles that are hardcoded values the dynamic list replaces (brand/model/category
  // names) — false for script nav bubbles ("Tanto faz", "Outra", back-links) that should stay.
  private isHardcodedOptionBubble(nodeId: string, bubble: FlowBubble): boolean {
    switch (nodeId) {
      case "busca_marca":
        return typeof bubble.params?.marca === "string" && bubble.params.marca !== "any";
      case "busca_marca_mais":
        return bubble.goto === "busca_modelo";
      case "troca_marca":
        return bubble.goto === "troca_modelo" && bubble.label !== "Outra";
      case "busca_modelo":
        return bubble.params?.modelo === undefined;
      case "troca_modelo":
        return bubble.label !== "Outro modelo";
      case "busca_categoria":
        return typeof bubble.params?.categoria === "string";
      case "busca_tipo":
        return typeof bubble.params?.tipo === "string" && bubble.params.tipo !== "any";
      default:
        return false;
    }
  }

  private async currentState(conversationId: string) {
    const conversation = await this.prisma.client.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException("Conversation not found");
    return conversation;
  }

  private async emit(businessId: string, conversationId: string, niche: string, nodeId: string, params: Record<string, unknown>): Promise<FlowSnapshot> {
    const flow = this.flowFor(niche);
    const node = flow.nodes[nodeId] ?? flow.nodes[flow.start];
    const { message, listings, whatsappUrl } = await this.resolveMessage(businessId, conversationId, node, params);

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
      const dynamicOptions = await this.dynamicOptionBubbles(businessId, node.id, params);
      if (dynamicOptions) {
        // Nav/fallback bubbles are whatever's left in the script once the hardcoded option
        // bubbles are stripped (e.g. "Tanto faz", "Qualquer modelo", "Outra", back-links).
        const nav = (node.bubbles ?? []).filter((b) => !this.isHardcodedOptionBubble(node.id, b));
        bubbles = [...dynamicOptions, ...nav, ...flow.global_bubbles];
      } else {
        bubbles = [...(node.bubbles ?? []), ...flow.global_bubbles];
      }
    }

    return {
      nodeId: node.id,
      message,
      bubbles: this.finalizeBubbles(bubbles),
      input: node.input ?? null,
      params,
      ...(listings ? { listings } : {}),
      ...(whatsappUrl !== undefined ? { whatsappUrl } : {}),
    };
  }

  // Human-handoff node ids a bubble can point at — "Falar com corretor"/"Falar com vendedor"
  // bubbles all land the visitor in the same place.
  private static readonly HANDOFF_GOTOS = new Set(["atendente", "handoff"]);
  private static readonly MAX_BUBBLES = 8;

  // Caps the total at MAX_BUBBLES, trimming from the node-specific options first (earliest-listed
  // = highest priority per the flow JSON's own ordering) while always keeping nav bubbles
  // (goto: start) and any real handoff bubbles the node offers.
  private finalizeBubbles(bubbles: FlowBubble[]): FlowBubble[] {
    if (bubbles.length <= FlowService.MAX_BUBBLES) return bubbles;

    const NEVER_TRIM_GOTOS = new Set(["start", ...FlowService.HANDOFF_GOTOS]);
    const keep: FlowBubble[] = [];
    const trimmable: FlowBubble[] = [];
    for (const b of bubbles) {
      if (NEVER_TRIM_GOTOS.has(b.goto)) keep.push(b);
      else trimmable.push(b);
    }
    const slotsLeft = Math.max(0, FlowService.MAX_BUBBLES - keep.length);
    // Reassemble in original relative order rather than keep-then-trimmable, so nav bubbles don't
    // all jump to the end of the list.
    const survivors = new Set([...trimmable.slice(0, slotsLeft), ...keep]);
    return bubbles.filter((b) => survivors.has(b));
  }

  async start(businessId: string, conversationId: string) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException("Business not found");
    const flow = this.flowFor(business.niche);

    const conversation = await this.currentState(conversationId);
    const nodeId = conversation.flowNodeId ?? flow.start;
    const params = (conversation.flowParams as Record<string, unknown>) ?? {};

    const snapshot = await this.emit(businessId, conversationId, business.niche, nodeId, params);

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

    const currentSnapshot = (conversation.flowSnapshot as unknown as FlowSnapshot) ?? null;
    const mergedParams = { ...(conversation.flowParams as Record<string, unknown>), ...bubbleParams };
    const nextSnapshot = await this.emit(businessId, conversationId, business.niche, goto, mergedParams);

    const nextHistory = currentSnapshot ? [...history, currentSnapshot].slice(-MAX_FLOW_HISTORY) : history;

    await this.prisma.client.conversation.update({
      where: { id: conversationId },
      data: {
        // Persist the resolved node id, not raw `goto` — emit() may have fallen back to flow.start.
        flowNodeId: nextSnapshot.nodeId,
        flowParams: mergedParams as any,
        flowHistory: nextHistory as any,
        flowSnapshot: nextSnapshot as any,
        fixedFlowTurns: { increment: 1 },
      },
    });

    this.recomputeLeadScore(businessId, conversation.leadId);
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

  // Cheap heuristic short-circuit: if free text matches one of the CURRENT node's own bubbles
  // (what's actually offered right now, including dynamic ones already resolved into the last
  // snapshot) with high confidence, treat it exactly like a bubble tap — zero LLM cost. Returns
  // null on anything ambiguous so the caller falls through to the normal LLM path unchanged.
  async matchFreeTextBubble(
    businessId: string,
    conversationId: string,
    visitorText: string,
  ): Promise<{ goto: string; params: Record<string, unknown> } | null> {
    const normalizedText = normalize(visitorText);
    const wordCount = normalizedText.split(" ").filter(Boolean).length;
    if (!normalizedText || wordCount > 6) return null; // long freeform messages are left to the LLM

    const conversation = await this.currentState(conversationId);
    const snapshot = (conversation.flowSnapshot as unknown as FlowSnapshot) ?? null;
    const bubbles = snapshot?.bubbles ?? [];
    if (!bubbles.length) return null;

    const matches = bubbles.filter((bubble) => {
      const expanded = expandWithSynonyms(keywordsOf(bubble.label));
      if (!expanded.size) return false;
      return [...expanded].some((kw) => normalizedText.includes(kw));
    });

    // Exactly one confident match required — ambiguity (0 or 2+ bubbles matching) falls through
    // to the LLM rather than risk a silent wrong flow-jump.
    if (matches.length !== 1) return null;
    return { goto: matches[0].goto, params: matches[0].params ?? {} };
  }
}
