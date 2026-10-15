import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { AccessLogService } from "../access/access-log.service";
import type { MemberContext } from "../access/member-context";
import { PushService } from "../push/push.service";
import { ChatHumanService } from "../chat/chat-human.service";
import { parseLimit, sliceCursor } from "../pharmacy-common/format";
import { accessDenied } from "../access/access-errors";
import { hasCrfOnFile } from "../access/team-rules";
import { buildSuggestion, handoffDetailDto, handoffListDto, handoffRequiresPharmacist, type HandoffRow } from "./handoff-dto";
import { buildChatResumeLink } from "./resume-link";
import { placeholderIconFor } from "../products/product-utils";
import { buildWhatsappLinks, buildWhatsappMessage, firstNameOf, MAX_WHATSAPP_MESSAGE_CHARS, whatsappDigits } from "./whatsapp-message";

const logger = new Logger("HandoffsService");
const VISITOR_LIVE_WINDOW_MS = 45_000;
export const MAX_SUGGESTED_PRODUCTS = 6;
const SANITY_MAX_QTY = 10;
const MAX_NOTE_CHARS = 300;

/** Products a pharmacist may recommend in a reply: active, in stock, class CONFIRMED as OTC or prescription (never controlled/unclassified). */
const LISTABLE_PRODUCT_WHERE = {
  active: true,
  deletedAt: null,
  stockQty: { gt: 0 },
  classConfirmedAt: { not: null },
  saleClass: { in: ["otc", "prescription"] as Array<"otc" | "prescription"> },
};

function badRequest(code: string, message: string) {
  return new BadRequestException({ statusCode: 400, error: "Bad Request", code, message });
}

interface ReplyInput {
  text?: unknown;
  productIds?: unknown;
  note?: unknown;
}

function conflict(code: string, message: string) {
  return new ConflictException({ statusCode: 409, error: "Conflict", code, message });
}

import { isNewQuestion } from "./reopen-rules";

@Injectable()
export class HandoffsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessLog: AccessLogService,
    private readonly push: PushService,
    private readonly human: ChatHumanService,
  ) {}

  /**
   * "answered" goes back to "open" when the customer wrote again after the answer (API.md 2.3).
   * Done lazily on reads so it never depends on the chat engine remembering to do it.
   */
  async reopenAnswered(businessId: string): Promise<void> {
    try {
      const candidates = await this.prisma.client.$queryRaw<Array<{ id: string; conversationId: string; answeredAt: Date }>>`SELECT h."id", h."conversationId", h."answeredAt" FROM "PharmacistHandoff" h WHERE h."businessId" = ${businessId} AND h."status" = 'answered' AND h."answeredAt" IS NOT NULL AND EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = h."conversationId" AND m."role" = 'visitor' AND m."createdAt" > h."answeredAt")`;
      for (const c of candidates) {
        const msgs = await this.prisma.client.message.findMany({ where: { conversationId: c.conversationId, role: "visitor", createdAt: { gt: c.answeredAt } }, select: { content: true }, take: 50 });
        // Thanks, buy intent and cart / checkout taps keep the handoff answered; only a new question re-opens it.
        if (msgs.some((m) => isNewQuestion(m.content))) await this.prisma.client.pharmacistHandoff.updateMany({ where: { id: c.id, status: "answered" }, data: { status: "open" } });
      }
    } catch (e) {
      logger.warn(`reopenAnswered failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async withLeads<T extends { leadId: string | null }>(businessId: string, rows: T[]): Promise<Array<T & { lead: { name: string | null; phone?: string | null } | null }>> {
    const ids = [...new Set(rows.map((r) => r.leadId).filter((x): x is string => !!x))];
    const leads = ids.length ? await this.prisma.client.lead.findMany({ where: { businessId, id: { in: ids } }, select: { id: true, name: true, phone: true, phoneNormalized: true } }) : [];
    const byId = new Map(leads.map((l) => [l.id, { name: l.name, phone: l.phoneNormalized || l.phone }]));
    return rows.map((r) => ({ ...r, lead: r.leadId ? byId.get(r.leadId) ?? null : null }));
  }

  async list(businessId: string, q: { status?: string; limit?: string; cursor?: string }, member?: MemberContext) {
    await this.reopenAnswered(businessId);
    const limit = parseLimit(q.limit);
    const status = q.status === "answered" || q.status === "closed" || q.status === "open" ? q.status : "open";
    const [rows, open, answered, urgent] = await Promise.all([
      this.prisma.client.pharmacistHandoff.findMany({
        where: { businessId, status },
        orderBy: [{ urgent: "desc" }, { createdAt: "asc" }, { id: "asc" }],
        take: limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
      this.prisma.client.pharmacistHandoff.count({ where: { businessId, status: "open" } }),
      this.prisma.client.pharmacistHandoff.count({ where: { businessId, status: "answered" } }),
      this.prisma.client.pharmacistHandoff.count({ where: { businessId, status: "open", urgent: true } }),
    ]);
    const { items, nextCursor } = sliceCursor(rows, limit);
    const withLeads = await this.withLeads(businessId, items);
    return { items: withLeads.map((h) => ({ ...handoffListDto(h as unknown as HandoffRow), canHandle: this.canHandle(member, h as unknown as HandoffRow) })), counts: { open, answered, urgent }, nextCursor };
  }

  /** Clinical handoffs need a member whose role requires a CRF and who has one on file; availability checks need only Atendimento edit. */
  private canHandle(m: MemberContext | undefined, h: { reason: string; urgent: boolean }): boolean {
    if (!m) return false;
    if (!handoffRequiresPharmacist(h.reason, h.urgent)) return true;
    return Boolean(m.requiresCrf && hasCrfOnFile(m.crf));
  }

  private assertCanHandle(m: MemberContext, h: { reason: string; urgent: boolean }) {
    if (this.canHandle(m, h)) return;
    throw accessDenied("CRF_REQUIRED", "Este atendimento exige um farmacêutico com CRF cadastrado.", { section: "atendimento", required: "edit" });
  }

  private async load(businessId: string, id: string) {
    const h = await this.prisma.client.pharmacistHandoff.findFirst({ where: { id, businessId } });
    if (!h) throw new NotFoundException("Atendimento não encontrado.");
    const [withLead] = await this.withLeads(businessId, [h]);
    return withLead;
  }

  private async detail(businessId: string, id: string, member?: MemberContext) {
    const h = await this.load(businessId, id);
    const brief = (h.brief ?? {}) as Record<string, unknown>;
    const ids = Array.isArray(brief.suggestedProducts) ? (brief.suggestedProducts as Array<{ productId?: string }>).map((p) => p?.productId).filter((x): x is string => typeof x === "string") : [];
    const products = ids.length ? await this.prisma.client.product.findMany({ where: { businessId, id: { in: ids }, active: true, deletedAt: null }, select: { id: true, name: true, presentation: true, priceCents: true, stockQty: true } }) : [];
    const live = new Map(products.map((p) => [p.id, { name: [p.name, p.presentation].filter(Boolean).join(" "), priceCents: p.priceCents, stockQty: p.stockQty }]));
    return { ...handoffDetailDto(h as unknown as HandoffRow, buildSuggestion(brief, live)), canHandle: this.canHandle(member, h as unknown as HandoffRow) };
  }

  async get(businessId: string, id: string, member?: MemberContext) {
    await this.reopenAnswered(businessId);
    return this.detail(businessId, id, member);
  }

  /** Listable catalog products for the reply picker (search by name / ingredient / presentation, or by ids for the "Usar sugestão" chips). */
  async searchProducts(businessId: string, q: { q?: string; ids?: string }) {
    const ids = (q.ids ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, MAX_SUGGESTED_PRODUCTS);
    const term = (q.q ?? "").trim().slice(0, 60);
    if (!ids.length && term.length < 2) return { items: [] };
    const rows = await this.prisma.client.product.findMany({
      where: {
        businessId,
        ...LISTABLE_PRODUCT_WHERE,
        ...(ids.length
          ? { id: { in: ids } }
          : { OR: [{ name: { contains: term, mode: "insensitive" } }, { activeIngredient: { contains: term, mode: "insensitive" } }, { presentation: { contains: term, mode: "insensitive" } }] }),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: ids.length ? MAX_SUGGESTED_PRODUCTS : 20,
    });
    const settings = await this.prisma.client.pharmacySettings.findFirst({ where: { businessId }, select: { maxQtyPerItemDefault: true } });
    return { items: rows.map((p) => this.suggestionItem(p, settings?.maxQtyPerItemDefault ?? null)) };
  }

  private suggestionItem(
    p: { id: string; name: string; presentation: string | null; priceCents: number; stockQty: number | null; maxQtyPerOrder: number | null; imageKey: string | null; updatedAt: Date; saleClass: string },
    defaultMax: number | null,
  ) {
    return {
      productId: p.id,
      name: p.name,
      presentation: p.presentation,
      priceCents: p.priceCents,
      inStock: (p.stockQty ?? 0) > 0,
      maxQty: p.maxQtyPerOrder ?? defaultMax ?? SANITY_MAX_QTY,
      imageUrl: p.imageKey ? `/api/public/products/${p.id}/image?v=${Math.floor(p.updatedAt.getTime() / 1000)}` : null,
      placeholderIcon: placeholderIconFor(p),
      requiresPrescription: p.saleClass === "prescription",
    };
  }

  /**
   * The pharmacist answers inside the customer's conversation (through ChatHumanService, which writes the
   * "Nome · Função entrou na conversa" banner and the author-stamped message). The reply carries text, product
   * suggestions (a `pharmacist_suggestion` card) or both.
   */
  async reply(m: MemberContext, id: string, input: ReplyInput | string) {
    const body: ReplyInput = typeof input === "string" ? { text: input } : input ?? {};
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (note.length > MAX_NOTE_CHARS) throw badRequest("INVALID_NOTE", `A observação deve ter até ${MAX_NOTE_CHARS} caracteres.`);
    let productIds: string[] = [];
    if (body.productIds !== undefined && body.productIds !== null) {
      if (!Array.isArray(body.productIds) || body.productIds.some((x) => typeof x !== "string" || !x)) throw badRequest("INVALID_PRODUCTS", "Lista de produtos inválida.");
      productIds = [...new Set(body.productIds as string[])];
      if (productIds.length > MAX_SUGGESTED_PRODUCTS) throw badRequest("TOO_MANY_PRODUCTS", `Indique no máximo ${MAX_SUGGESTED_PRODUCTS} produtos.`);
    }
    if (!productIds.length && (text.length < 1 || text.length > 2000)) throw badRequest("INVALID_TEXT", "A resposta deve ter de 1 a 2000 caracteres.");
    if (text.length > 2000) throw badRequest("INVALID_TEXT", "A resposta deve ter de 1 a 2000 caracteres.");
    await this.reopenAnswered(m.businessId);
    const h = await this.load(m.businessId, id);
    this.assertCanHandle(m, h);
    if (h.status === "closed") throw conflict("INVALID_STATE", "Este atendimento já foi encerrado.");

    // Every product must be listable AND belong to this business; anything else rejects the whole reply.
    let items: ReturnType<HandoffsService["suggestionItem"]>[] = [];
    if (productIds.length) {
      const rows = await this.prisma.client.product.findMany({ where: { businessId: m.businessId, id: { in: productIds }, ...LISTABLE_PRODUCT_WHERE } });
      if (rows.length !== productIds.length) throw badRequest("PRODUCT_NOT_LISTABLE", "Algum produto não pode ser indicado (sem estoque, inativo, controlado ou sem classificação confirmada).");
      const settings = await this.prisma.client.pharmacySettings.findFirst({ where: { businessId: m.businessId }, select: { maxQtyPerItemDefault: true } });
      const byId = new Map(rows.map((r) => [r.id, r]));
      items = productIds.map((pid) => this.suggestionItem(byId.get(pid)!, settings?.maxQtyPerItemDefault ?? null));
    }

    const conversation = await this.prisma.client.conversation.findFirst({
      where: { id: h.conversationId, businessId: m.businessId },
      select: { id: true, resumeToken: true, lastVisitorSeenAt: true, business: { select: { slug: true, name: true } } },
    });
    if (!conversation) throw conflict("CONVERSATION_GONE", "A conversa deste atendimento não existe mais.");

    // The chat module owns how a person appears in a conversation: join banner once per person, then the
    // owner message carrying name + role. No brief text is ever written to any Message.
    const now = new Date();
    const author = { memberId: m.memberId, name: m.name, roleName: m.roleName };
    if (text) await this.human.recordHumanReply({ businessId: m.businessId, conversationId: conversation.id, author, text });
    let answerText = text;
    if (items.length) {
      const content = `${m.name} indicou ${items.length === 1 ? "este produto" : "estes produtos"} para você:${note ? ` ${note}` : ""}`;
      answerText = answerText || content;
      await this.human.recordHumanCard({
        businessId: m.businessId,
        conversationId: conversation.id,
        author,
        content,
        uiData: { type: "pharmacist_suggestion", from: { name: m.name, roleName: m.roleName }, ...(note ? { note } : {}), items },
      });
    }
    const { inProgress: _clear, ...briefWithoutMarker } = (h.brief && typeof h.brief === "object" ? h.brief : {}) as Record<string, unknown>;
    await this.prisma.client.pharmacistHandoff.update({
      where: { id },
      data: { status: "answered", answerText, answeredAt: now, answeredByMemberId: m.memberId, answeredByName: m.name, answeredByRole: m.roleName, ...(_clear ? { brief: briefWithoutMarker as object } : {}) },
    });

    // Push only when the visitor is not looking at the chat. The body is deliberately generic: a lock screen must not show health text.
    const live = !!conversation.lastVisitorSeenAt && Date.now() - conversation.lastVisitorSeenAt.getTime() < VISITOR_LIVE_WINDOW_MS;
    if (!live) {
      const url = buildChatResumeLink({ slug: conversation.business.slug, conversationId: conversation.id, resumeToken: conversation.resumeToken });
      const clinical = handoffRequiresPharmacist(h.reason, h.urgent);
      this.push.sendToConversation(conversation.id, { title: conversation.business.name, body: clinical ? "O farmacêutico respondeu ao seu atendimento." : "Respondemos à sua pergunta.", url, tag: `handoff-${id}` }).catch(() => {});
    }
    // No health text in the log: product ids and count only.
    await this.accessLog.record({
      businessId: m.businessId,
      actor: m,
      action: "handoff.answer",
      summary: items.length ? "Respondeu atendimento com indicação de produtos" : "Respondeu atendimento",
      detail: { handoffId: id, ...(items.length ? { productCount: items.length, productIds } : {}) },
    });
    return this.detail(m.businessId, id, m);
  }

  /** Visitor resume link (same conversation + history, no cookie needed). Staff only; access-logged, no health data. */
  async chatLink(m: MemberContext, id: string) {
    const h = await this.load(m.businessId, id);
    this.assertCanHandle(m, h);
    const conversation = await this.prisma.client.conversation.findFirst({
      where: { id: h.conversationId, businessId: m.businessId },
      select: { id: true, resumeToken: true, business: { select: { slug: true } } },
    });
    if (!conversation) throw conflict("CONVERSATION_GONE", "A conversa deste atendimento não existe mais.");
    const url = await this.ensureResumeLink(conversation);
    await this.accessLog.record({ businessId: m.businessId, actor: m, action: "handoff.chat_link", summary: "Copiou o link do chat de um atendimento", detail: { handoffId: id } });
    return { url };
  }

  private async ensureResumeLink(conversation: { id: string; resumeToken: string | null; business: { slug: string } }): Promise<string> {
    let token = conversation.resumeToken;
    if (!token) {
      token = randomBytes(16).toString("base64url");
      await this.prisma.client.conversation.update({ where: { id: conversation.id }, data: { resumeToken: token } });
    }
    return buildChatResumeLink({ slug: conversation.business.slug, conversationId: conversation.id, resumeToken: token });
  }

  async close(m: MemberContext, id: string) {
    const h = await this.load(m.businessId, id);
    this.assertCanHandle(m, h);
    if (h.status === "closed") return this.detail(m.businessId, id, m);
    await this.prisma.client.pharmacistHandoff.update({ where: { id }, data: { status: "closed", closedAt: new Date() } });
    await this.accessLog.record({ businessId: m.businessId, actor: m, action: "handoff.close", summary: "Encerrou atendimento", detail: { handoffId: id } });
    return this.detail(m.businessId, id, m);
  }

  // -------------------------------------------------------------------------------------------
  // WhatsApp hand-over ("Iniciar atendimento"): the conversation continues on WhatsApp Web.
  // The full phone number is returned ONLY here (atendimento:edit + CRF) and every call is access-logged.
  // -------------------------------------------------------------------------------------------

  /** Default message + links for the preview dialog. Logs that the number was revealed (no health data in the log). */
  async whatsappDraft(m: MemberContext, id: string) {
    const h = await this.load(m.businessId, id);
    this.assertCanHandle(m, h);
    if (h.status === "closed") throw conflict("INVALID_STATE", "Este atendimento já foi encerrado.");
    const phone = await this.customerPhone(m.businessId, h.leadId);
    if (!phone) {
      throw conflict("NO_PHONE", "Este cliente não informou o WhatsApp. Responda pelo chat.");
    }
    const business = await this.prisma.client.business.findFirst({ where: { id: m.businessId }, select: { name: true, slug: true } });
    const conversation = await this.prisma.client.conversation.findFirst({ where: { id: h.conversationId, businessId: m.businessId }, select: { id: true, resumeToken: true } });
    const resumeLink = conversation && business ? await this.ensureResumeLink({ ...conversation, business: { slug: business.slug } }) : null;
    const message = buildWhatsappMessage({
      customerName: h.lead?.name ?? null,
      attendantName: m.name,
      attendantRole: m.roleName,
      pharmacyName: business?.name ?? "",
      reason: h.reason,
      brief: (h.brief ?? {}) as Record<string, unknown>,
      resumeLink,
    });
    const links = buildWhatsappLinks(phone, message)!;
    await this.accessLog.record({ businessId: m.businessId, actor: m, action: "handoff.whatsapp_link", summary: "Abriu o contato por WhatsApp de um atendimento", detail: { handoffId: id } });
    return {
      customerFirstName: firstNameOf(h.lead?.name) || null,
      phone: links.phoneDigits,
      message,
      resumeLink,
      maxChars: MAX_WHATSAPP_MESSAGE_CHARS,
      webUrl: links.webUrl,
      appUrl: links.appUrl,
    };
  }

  private async customerPhone(businessId: string, leadId: string | null): Promise<string | null> {
    if (!leadId) return null;
    const lead = await this.prisma.client.lead.findFirst({ where: { id: leadId, businessId }, select: { phone: true, phoneNormalized: true } });
    const phone = lead?.phoneNormalized || lead?.phone || null;
    return whatsappDigits(phone) ? phone : null;
  }

  /**
   * Marks the handoff "em atendimento" (brief.inProgress; the status machine stays open/answered/closed) and records who
   * started it. `channel`: "whatsapp" (opened WhatsApp Web) or "chat" (answering in the web chat).
   */
  async start(m: MemberContext, id: string, channelRaw?: unknown) {
    const channel = channelRaw === "chat" ? "chat" : "whatsapp";
    await this.reopenAnswered(m.businessId);
    const h = await this.load(m.businessId, id);
    this.assertCanHandle(m, h);
    if (h.status === "closed") throw conflict("INVALID_STATE", "Este atendimento já foi encerrado.");
    if (h.status === "answered") throw conflict("INVALID_STATE", "Este atendimento já foi respondido.");
    const brief = (h.brief && typeof h.brief === "object" ? h.brief : {}) as Record<string, unknown>;
    // Same person, same channel: already marked (a double click must not rewrite the marker or the log).
    const current = brief.inProgress as { byMemberId?: string; channel?: string } | undefined;
    if (current?.byMemberId === m.memberId && current.channel === channel) return this.detail(m.businessId, id, m);
    const inProgress = { at: new Date().toISOString(), byMemberId: m.memberId, byName: m.name, byRole: m.roleName, channel };
    await this.prisma.client.pharmacistHandoff.update({ where: { id }, data: { brief: { ...brief, inProgress } as object } });
    await this.accessLog.record({
      businessId: m.businessId,
      actor: m,
      action: "handoff.start",
      summary: channel === "whatsapp" ? "Iniciou atendimento pelo WhatsApp" : "Iniciou atendimento pelo chat",
      detail: { handoffId: id, channel },
    });
    return this.detail(m.businessId, id, m);
  }

  /** The conversation moved to WhatsApp: close the loop (status answered) and leave one system line in the web chat. */
  async markAnswered(m: MemberContext, id: string) {
    await this.reopenAnswered(m.businessId);
    const h = await this.load(m.businessId, id);
    this.assertCanHandle(m, h);
    if (h.status === "closed") throw conflict("INVALID_STATE", "Este atendimento já foi encerrado.");
    if (h.status === "answered") return this.detail(m.businessId, id, m);
    const now = new Date();
    await this.human.recordSystemNote({
      businessId: m.businessId,
      conversationId: h.conversationId,
      author: { memberId: m.memberId, name: m.name, roleName: m.roleName },
      text: `${m.name} · ${m.roleName} continuou o atendimento pelo WhatsApp`,
    });
    const brief = (h.brief && typeof h.brief === "object" ? h.brief : {}) as Record<string, unknown>;
    const { inProgress: _drop, ...rest } = brief;
    await this.prisma.client.pharmacistHandoff.update({
      where: { id },
      data: {
        status: "answered",
        answerText: "Atendimento continuado pelo WhatsApp.",
        answeredAt: now,
        answeredByMemberId: m.memberId,
        answeredByName: m.name,
        answeredByRole: m.roleName,
        brief: rest as object,
      },
    });
    await this.accessLog.record({ businessId: m.businessId, actor: m, action: "handoff.whatsapp_answer", summary: "Marcou atendimento como respondido (WhatsApp)", detail: { handoffId: id } });
    return this.detail(m.businessId, id, m);
  }
}
