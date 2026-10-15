import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { hasPermission } from "@realwise/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { tryEmbedText } from "../../inference/embed-client";
import { generateFromGateway } from "../../inference/gateway-client";
import { AccessLogService } from "../access/access-log.service";
import { accessDenied } from "../access/access-errors";
import type { MemberContext } from "../access/member-context";
import { expandAbbreviations, retrieveChunksForChat } from "../chat/knowledge-retrieval";
import { foldText } from "../chat/kb-matching";
import { asksForDosage, guardPharmacyText, hasDosageAdvice, hasRecommendation } from "../chat/pharmacy/guards";
import { clinicalQuestion } from "../chat/pharmacy/general-question";

export const QA_SOURCE = "qa";
export const QA_MAX_PER_BUSINESS = 500;
const MIN_QUESTION = 5;
const MAX_QUESTION = 200;
const MIN_ANSWER = 2;
const MAX_ANSWER = 1200;

export type SearchMode = "semantic" | "keyword" | "mixed" | "pending";

function badRequest(code: string, message: string) {
  return new BadRequestException({ statusCode: 400, error: "Bad Request", code, message });
}
function conflict(code: string, message: string) {
  return new ConflictException({ statusCode: 409, error: "Conflict", code, message });
}

/** Personal data has no place in the knowledge base (CPF, long digit runs such as cards / phones of customers). */
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/;

export interface QaInput {
  question: string;
  answer: string;
}

/** Validates and cleans a Q&A pair. Pure: throws the pt-BR 400s the dashboard shows verbatim. */
export function validateQa(input: { question?: unknown; answer?: unknown }): QaInput {
  const question = typeof input.question === "string" ? input.question.replace(/\s+/g, " ").trim() : "";
  const answer = typeof input.answer === "string" ? input.answer.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : "";
  if (question.length < MIN_QUESTION || question.length > MAX_QUESTION) throw badRequest("INVALID_QUESTION", `A pergunta deve ter de ${MIN_QUESTION} a ${MAX_QUESTION} caracteres.`);
  if (answer.length < MIN_ANSWER || answer.length > MAX_ANSWER) throw badRequest("INVALID_ANSWER", `A resposta deve ter de ${MIN_ANSWER} a ${MAX_ANSWER} caracteres.`);
  if (hasDosageAdvice(question) || hasDosageAdvice(answer) || asksForDosage(question)) {
    throw badRequest("DOSAGE_CONTENT", "Não salvamos orientações de dose, horário ou modo de uso. Isso é com o farmacêutico: o Alex sempre encaminha esse tipo de pergunta.");
  }
  if (clinicalQuestion(question)) {
    throw badRequest("CLINICAL_CONTENT", "Perguntas sobre sintomas, remédios para algum problema ou saúde ficam com o farmacêutico, e o Alex sempre as encaminha. Cadastre aqui só informações da loja.");
  }
  if (hasRecommendation(answer)) {
    throw badRequest("RECOMMENDATION_CONTENT", "A resposta parece indicar ou recomendar um remédio. Isso é com o farmacêutico. Reescreva só com informações da loja.");
  }
  if (CPF.test(question) || CPF.test(answer)) {
    throw badRequest("PERSONAL_DATA", "Não coloque dados de clientes (como CPF) na base de conhecimento.");
  }
  return { question, answer };
}

export function qaChunkContent(q: QaInput): string {
  return `Pergunta: ${q.question}\nResposta: ${q.answer}`;
}

/** The answer part of a stored Q&A chunk, or null for an ordinary document chunk. */
export function answerOfQaChunk(content: string): string | null {
  const m = content.match(/^Pergunta: [\s\S]*?\nResposta: ([\s\S]*)$/);
  return m ? m[1].trim() : null;
}

function modeOf(total: number, embedded: number): SearchMode {
  if (total === 0) return "pending";
  if (embedded === 0) return "keyword";
  return embedded === total ? "semantic" : "mixed";
}

@Injectable()
export class KnowledgeQaService {
  private readonly logger = new Logger(KnowledgeQaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessLog: AccessLogService,
  ) {}

  /** documentId -> how its chunks are searched (semantic vectors, keyword only, mixed, or not indexed yet). */
  async searchModes(businessId: string, documentIds?: string[]): Promise<Map<string, SearchMode>> {
    const out = new Map<string, SearchMode>();
    try {
      const rows = await this.prisma.client.$queryRawUnsafe<{ documentId: string; total: number; embedded: number }[]>(
        `SELECT "documentId", COUNT(*)::int AS total, COUNT(embedding)::int AS embedded FROM "KnowledgeChunk" WHERE "businessId" = $1 GROUP BY "documentId"`,
        businessId,
      );
      for (const r of rows) if (!documentIds || documentIds.includes(r.documentId)) out.set(r.documentId, modeOf(r.total, r.embedded));
    } catch {
      // informational only
    }
    return out;
  }

  private toDto(d: { id: string; filename: string; extractedMarkdown: string | null; createdAt: Date }, modes: Map<string, SearchMode>) {
    return { id: d.id, question: d.filename, answer: d.extractedMarkdown ?? "", createdAt: d.createdAt, searchMode: modes.get(d.id) ?? ("pending" as SearchMode) };
  }

  async list(businessId: string) {
    const docs = await this.prisma.client.knowledgeDocument.findMany({ where: { businessId, source: QA_SOURCE }, orderBy: { createdAt: "desc" }, take: QA_MAX_PER_BUSINESS });
    const modes = await this.searchModes(businessId);
    return { items: docs.map((d) => this.toDto(d, modes)), max: QA_MAX_PER_BUSINESS };
  }

  private async writeChunk(businessId: string, documentId: string, qa: QaInput) {
    await this.prisma.client.knowledgeChunk.deleteMany({ where: { documentId, businessId } });
    const content = qaChunkContent(qa);
    const chunk = await this.prisma.client.knowledgeChunk.create({
      data: { businessId, documentId, ordinal: 0, content, tokenCount: Math.ceil(content.length / 4) },
    });
    // Embedding is best-effort: without it the pair is still searchable by keyword.
    const embedding = await tryEmbedText(content);
    if (embedding) {
      try {
        await this.prisma.client.$executeRawUnsafe(`UPDATE "KnowledgeChunk" SET embedding = $1::vector WHERE id = $2`, `[${embedding.join(",")}]`, chunk.id);
      } catch {
        // stays keyword-searchable
      }
    }
  }

  private async findDuplicate(businessId: string, question: string, exceptId?: string) {
    const folded = foldText(question).replace(/[^a-z0-9]/g, "");
    const all = await this.prisma.client.knowledgeDocument.findMany({ where: { businessId, source: QA_SOURCE }, select: { id: true, filename: true } });
    return all.find((d) => d.id !== exceptId && foldText(d.filename).replace(/[^a-z0-9]/g, "") === folded) ?? null;
  }

  /** Creates a Q&A; `replaceExisting` updates the answer of an identical question instead of refusing (used by "Responder e salvar"). */
  async create(m: MemberContext, input: { question?: unknown; answer?: unknown }, opts: { replaceExisting?: boolean } = {}) {
    const qa = validateQa(input);
    const dup = await this.findDuplicate(m.businessId, qa.question);
    if (dup) {
      if (!opts.replaceExisting) throw conflict("DUPLICATE_QUESTION", "Já existe uma resposta para essa pergunta. Edite a existente.");
      return this.update(m, dup.id, qa);
    }
    const count = await this.prisma.client.knowledgeDocument.count({ where: { businessId: m.businessId, source: QA_SOURCE } });
    if (count >= QA_MAX_PER_BUSINESS) throw badRequest("TOO_MANY_QA", `Limite de ${QA_MAX_PER_BUSINESS} perguntas e respostas atingido.`);
    const doc = await this.prisma.client.knowledgeDocument.create({
      data: {
        businessId: m.businessId,
        filename: qa.question,
        mimeType: "text/plain",
        sizeBytes: qaChunkContent(qa).length,
        storageKey: `qa/${m.businessId}/${Date.now()}`,
        source: QA_SOURCE,
        status: "processed",
        extractedMarkdown: qa.answer,
      },
    });
    await this.writeChunk(m.businessId, doc.id, qa);
    await this.accessLog.record({ businessId: m.businessId, actor: m, action: "knowledge.qa_create", summary: "Cadastrou uma pergunta e resposta na base de conhecimento", detail: { documentId: doc.id } });
    const modes = await this.searchModes(m.businessId, [doc.id]);
    return this.toDto(doc, modes);
  }

  async update(m: MemberContext, id: string, input: { question?: unknown; answer?: unknown }) {
    const qa = validateQa(input);
    const doc = await this.prisma.client.knowledgeDocument.findFirst({ where: { id, businessId: m.businessId, source: QA_SOURCE } });
    if (!doc) throw new NotFoundException("Pergunta não encontrada.");
    if (await this.findDuplicate(m.businessId, qa.question, id)) throw conflict("DUPLICATE_QUESTION", "Já existe uma resposta para essa pergunta.");
    const updated = await this.prisma.client.knowledgeDocument.update({
      where: { id },
      data: { filename: qa.question, extractedMarkdown: qa.answer, sizeBytes: qaChunkContent(qa).length, status: "processed" },
    });
    await this.writeChunk(m.businessId, id, qa);
    await this.accessLog.record({ businessId: m.businessId, actor: m, action: "knowledge.qa_update", summary: "Editou uma pergunta e resposta da base de conhecimento", detail: { documentId: id } });
    const modes = await this.searchModes(m.businessId, [id]);
    return this.toDto(updated, modes);
  }

  async remove(m: MemberContext, id: string) {
    const doc = await this.prisma.client.knowledgeDocument.findFirst({ where: { id, businessId: m.businessId, source: QA_SOURCE } });
    if (!doc) throw new NotFoundException("Pergunta não encontrada.");
    await this.prisma.client.knowledgeChunk.deleteMany({ where: { documentId: id, businessId: m.businessId } });
    await this.prisma.client.knowledgeDocument.delete({ where: { id } });
    await this.accessLog.record({ businessId: m.businessId, actor: m, action: "knowledge.qa_delete", summary: "Removeu uma pergunta e resposta da base de conhecimento", detail: { documentId: id } });
    return { ok: true };
  }

  // ------------------------------------------------------------------------------------------
  // "Testar o Alex": retrieval + the answer he would give. Never creates a conversation, message or handoff.
  // ------------------------------------------------------------------------------------------

  async testAlex(businessId: string, rawQuestion: unknown) {
    const question = typeof rawQuestion === "string" ? rawQuestion.replace(/\s+/g, " ").trim() : "";
    if (question.length < 3 || question.length > 300) throw badRequest("INVALID_QUESTION", "Digite uma pergunta de 3 a 300 caracteres.");

    if (asksForDosage(question) || clinicalQuestion(question)) {
      return {
        question,
        outcome: "pharmacist" as const,
        answer: null,
        message: "O Alex não responde isso pela base: perguntas de saúde, dose ou sintomas vão direto para o farmacêutico.",
        sources: [],
      };
    }

    const { tenant } = await retrieveChunksForChat(this.prisma, businessId, "farmacia", question, { text: expandAbbreviations(question) });
    if (tenant.length === 0) {
      return {
        question,
        outcome: "team" as const,
        answer: null,
        message: "Nada na base responde isso. O Alex avisaria o cliente que vai pedir para a equipe confirmar e abriria uma pergunta para vocês responderem.",
        sources: [],
      };
    }

    const chunkRows = await this.prisma.client.knowledgeChunk.findMany({
      where: { id: { in: tenant.map((c) => c.id) }, businessId },
      select: { id: true, documentId: true },
    });
    const docRows = await this.prisma.client.knowledgeDocument.findMany({
      where: { id: { in: [...new Set(chunkRows.map((r) => r.documentId))] }, businessId },
      select: { id: true, filename: true, source: true },
    });
    const docById = new Map(docRows.map((d) => [d.id, d]));
    const docOf = new Map(chunkRows.map((r) => [r.id, docById.get(r.documentId)]));
    const sources = tenant.map((c, i) => {
      const doc = docOf.get(c.id);
      const isQa = doc?.source === QA_SOURCE;
      return {
        kind: isQa ? ("qa" as const) : ("document" as const),
        name: doc?.filename ?? "Documento",
        excerpt: (isQa ? answerOfQaChunk(c.content) ?? c.content : c.content).replace(/\s+/g, " ").slice(0, 240),
        used: i === 0,
      };
    });

    const top = tenant[0];
    const qaAnswer = answerOfQaChunk(top.content);
    if (qaAnswer) {
      return { question, outcome: "answer" as const, answer: qaAnswer, answerFrom: "qa" as const, message: null, sources };
    }

    // A document: ask the model for a short grounded answer, like Alex does; fall back to the excerpt.
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId }, select: { name: true } });
    const context = tenant.slice(0, 3).map((c, i) => `[${i + 1}] ${c.content.slice(0, 1500)}`).join("\n\n");
    try {
      const result = await generateFromGateway({
        purpose: "chat",
        businessId,
        temperature: 0.2,
        maxTokens: 260,
        timeoutMs: 25000,
        systemPrompt: `Você é o Alex, atendente virtual da farmácia ${business?.name ?? ""}. Responda em português do Brasil, em até 3 frases curtas e acolhedoras, usando SOMENTE os trechos fornecidos. Nunca dê dose, horário de uso nem indique remédios. Se os trechos não responderem à pergunta, responda exatamente: NAO_SEI`,
        prompt: `Trechos da base de conhecimento:\n${context}\n\nPergunta do cliente: ${question}`,
      });
      const text = result.text.trim();
      if (!text || /NAO_SEI/.test(text)) {
        return { question, outcome: "team" as const, answer: null, message: "Os trechos encontrados não respondem a pergunta. O Alex pediria para a equipe confirmar.", sources: sources.map((s) => ({ ...s, used: false })) };
      }
      const guarded = guardPharmacyText(text);
      return { question, outcome: "answer" as const, answer: guarded.text, answerFrom: "document" as const, message: null, sources };
    } catch (error) {
      this.logger.warn(`Testar o Alex: model answer unavailable (${error instanceof Error ? error.message : String(error)})`);
      return {
        question,
        outcome: "answer" as const,
        answer: sources[0].excerpt,
        answerFrom: "excerpt" as const,
        message: "Não foi possível gerar a resposta completa agora; este é o trecho do documento que o Alex usaria.",
        sources,
      };
    }
  }

  // ------------------------------------------------------------------------------------------
  // Perguntas sem resposta: general_question handoffs, answered and (optionally) saved to the KB in one go.
  // ------------------------------------------------------------------------------------------

  async listOpenQuestions(businessId: string) {
    const rows = await this.prisma.client.pharmacistHandoff.findMany({
      where: { businessId, reason: "general_question", status: "open" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      items: rows.map((h) => {
        const brief = (h.brief && typeof h.brief === "object" ? h.brief : {}) as Record<string, unknown>;
        const question = typeof brief.question === "string" && brief.question ? brief.question : h.summary;
        return { id: h.id, question, createdAt: h.createdAt };
      }),
    };
  }

  /**
   * "Responder e salvar na base": sends the answer through `reply` (the handoff reply, owned by the handoffs module) and,
   * unless `saveToKb` is false, stores the Q&A. The KB entry is validated BEFORE anything is sent.
   */
  async answerOpenQuestion(
    m: MemberContext,
    handoffId: string,
    body: { answer?: unknown; question?: unknown; saveToKb?: unknown },
    reply: (text: string) => Promise<unknown>,
  ) {
    if (!hasPermission(m.permissions, "atendimento", "edit")) {
      throw accessDenied("PERMISSION_DENIED", "Você precisa de acesso de edição em Atendimento para responder perguntas dos clientes.", { section: "atendimento", required: "edit" });
    }
    const saveToKb = body.saveToKb !== false;
    if (saveToKb && !hasPermission(m.permissions, "conhecimento", "edit")) {
      throw accessDenied("PERMISSION_DENIED", "Você pode responder, mas não salvar na base de conhecimento.", { section: "conhecimento", required: "edit" });
    }
    const handoff = await this.prisma.client.pharmacistHandoff.findFirst({ where: { id: handoffId, businessId: m.businessId, reason: "general_question" } });
    if (!handoff) throw new NotFoundException("Pergunta não encontrada.");
    const brief = (handoff.brief && typeof handoff.brief === "object" ? handoff.brief : {}) as Record<string, unknown>;
    const original = typeof brief.question === "string" && brief.question ? brief.question : handoff.summary;
    // The saved question may be reworded by the team ("Vocês têm estacionamento?" instead of the customer's typo-ridden text).
    const questionForKb = typeof body.question === "string" && body.question.trim() ? body.question : original;

    const qa = saveToKb ? validateQa({ question: questionForKb, answer: body.answer }) : null;
    const answer = typeof body.answer === "string" ? body.answer.trim() : "";
    if (!answer) throw badRequest("INVALID_ANSWER", "Escreva a resposta.");

    const handoffResult = await reply(answer);
    const saved = qa ? await this.create(m, qa, { replaceExisting: true }) : null;
    return { handoff: handoffResult, saved };
  }
}
