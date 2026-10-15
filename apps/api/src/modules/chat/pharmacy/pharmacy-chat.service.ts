// Pharmacy chat engine. CODE decides safety and money; the model never does:
//   red flag -> lane router (OTC cart / prescription / controlled / symptom handoff / general)
//   -> deterministic cart + checkout state machine persisted in Conversation.pharmacyState.
// Everything here works with the model completely unavailable. See docs/pharmacy/CHAT_ENGINE_REPORT.md.

import { retrieveChunksForChat, expandAbbreviations } from "../knowledge-retrieval";
import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { PrismaService } from "../../../prisma/prisma.service";
import { AnalyticsService } from "../../analytics/analytics.service";
import { CustomerProfileService } from "../../customers/customer-profile.service";
import {
  InvalidAddressNumberError,
  canonicalPhone,
  firstName,
  formatCep,
  maskAddress,
  normalizeAddressNumber,
  normalizeCep,
} from "../../customers/address-utils";
import type { OperationModeInfo } from "@realwise/shared";
import { loadOperationMode } from "../../pharmacy-common/operation-mode";
import { getPersona } from "../personas";
import { isGreeting } from "../safe-replies";
import { maskPhoneBr } from "../../handoffs/whatsapp-message";
import { ATT_CHIPS, ATT_COPY, COMMERCE_ACTIONS, asksAboutProduct, attendanceChips, attendancePickupLine, buildProductRequestBrief, hasProductMention, isBareProductIntent } from "./attendance";
import { askedDeliveryPlace, clinicalQuestion, looksLikeQuestion, offTopicChat, unknownStoreTopic } from "./general-question";
import { isSuggestionMessage, parseSuggestionChoice, type SuggestionChoice } from "./suggestion";
import { parseQtyEdit } from "./qty-edit";
import { PharmacyCatalog, productLabel, scoreProduct, type Resolution } from "./catalog";
import { CHIPS, COPY, CONSENT_VERSION, acceptedPaymentPhrase, consentCard, nameComma, paymentPhrase, pharmacistRef, symptomIntroFor } from "./copy";
import { DOSAGE_REFUSAL, asksForDosage, guardSymptomLaneText } from "./guards";
import { OrderRuleError } from "./ports";
import { CVV_NUMBER, SAMU_NUMBER, detectRedFlag, isInfantWithFever, redFlagReplyText, type RedFlagHit } from "./red-flags";
import {
  autoConfirmDecision,
  describeOpeningHours,
  effectiveMaxQty,
  gateForProduct,
  inStock,
  isInsideDeliveryArea,
  isOpenNow,
  isSheetStale,
} from "./rules";
import {
  CHIP,
  buildSymptomBrief,
  detailPrompt,
  detectsSymptomIntent,
  filterSuggestions,
  needsDetail,
  nextStep,
  recordAnswer,
  stepPrompt,
  suggestionKeywords,
  summaryLine,
  validateAge,
  inferFromSymptomText,
  patientOf,
  asksRecommendation,
} from "./symptom";
import { brl, extractSelfName, fold, isAffirmative, isNegative, isValidEmail, pickDigits, productTokens, titleCaseName } from "./text";
import {
  PHARMACY_HANDOFFS_PORT,
  PHARMACY_NOTIFIER_PORT,
  PHARMACY_ORDERS_PORT,
  emptyState,
  type AddressSnapshot,
  type Awaiting,
  type CartLine,
  type CreateHandoffInput,
  type CheckoutStep,
  type Fulfillment,
  type OutMessage,
  type PharmacyHandoffsPort,
  type PharmacyNotifierPort,
  type PharmacyOrdersPort,
  type PharmacySettingsView,
  type PharmacyState,
  type PharmacyTurnResult,
  type PharmacyView,
  type ProductRow,
  type SymptomStep,
  type UiPayload,
} from "./types";
import { buildCartDto, cartUi, catalogListUi, productCardUi, suggestionUi } from "./ui";

const RED_FLAG_COOLDOWN_MS = 30 * 60_000;
const MAX_CART_LINES = 15;
const SUGGESTION_MAX_AGE_MS = 14 * 86_400_000;
/** Legacy and short purpose names -> the canonical purposes of ConsentRecord memory. */
const CONSENT_CANONICAL: Record<string, string> = { atendimento: "order_contact", pedido: "order_contact", contact: "pharmacy_contact" };

/** Chips (and their typed twins) answered straight from PharmacySettings, in any state of the conversation. */
const INFO_CHIPS = new Set(
  ["Horários e entrega", "Horário de funcionamento", "Horários de funcionamento", "Taxa de entrega", "Todas as informações", "Quero ver todas as informações", "Ver todas as informações"].map(fold),
);

/** Everything one turn works on. */
class Turn {
  out: OutMessage[] = [];
  suggestions: string[] | undefined;
  dirty = false;
  constructor(
    public state: PharmacyState,
    readonly business: { id: string; name: string; slug: string; timezone?: string | null; niche: string },
    readonly conversation: { id: string; leadId: string | null; visitorToken: string },
    readonly settings: PharmacySettingsView,
    readonly mode: OperationModeInfo,
  ) {}
  /** Text glued in front of the next message (e.g. the greeting for a recognized customer). */
  prefix = "";
  /** The address of this review was confirmed earlier in the conversation (the review says so). */
  reusedAddress = false;
  /** First name of the customer when already known (typed in this conversation or a recognized returning customer). */
  get first(): string | null {
    const c = this.state.contact;
    const raw = c.returningFirstName || (c.name ? c.name.trim().split(/\s+/)[0] : "");
    return raw ? raw : null;
  }
  say(text: string, ui?: UiPayload | null) {
    const full = this.prefix ? `${this.prefix} ${text}` : text;
    this.prefix = "";
    this.out.push({ text: full, ui: ui ?? null });
    this.dirty = true;
  }
  chips(...labels: string[]) {
    this.suggestions = labels.length > 0 ? labels : undefined;
  }
}

export interface PharmacyAction {
  type: string;
  [key: string]: unknown;
}

/** The weekday a short hours question names ("e o domingo?", "sábado abre?"), as a matcher on folded opening-hours labels. */
function hoursDayFilter(f: string): RegExp | null {
  if (/\bferiados?\b/.test(f)) return /feriado/;
  if (/\b(fins? de semana|finais de semana)\b/.test(f)) return /sabado|domingo|fim de semana/;
  if (/\bdomingos?\b/.test(f)) return /domingo/;
  if (/\bsabados?\b/.test(f)) return /sabado/;
  const m = f.match(/\b(segunda|terca|quarta|quinta|sexta)\b/);
  return m ? new RegExp(`${m[1]}|segunda a sexta|dias? uteis|semana`) : null;
}

/** "um remédio", "algum medicamento", "um produto": no product name to look up. */
function isGenericProductAsk(f: string): boolean {
  const generic = new Set(["remedio", "remedios", "medicamento", "medicamentos", "produto", "produtos", "algo", "coisa", "alguma", "qualquer", "um", "uma", "uns", "de", "para", "pra", "mim", "meu", "minha", "uso", "pessoal", "farmacia", "da", "do", "preciso", "quero", "queria", "gostaria", "comprar", "pedir", "levar", "o", "a", "que", "mais", "barato", "mais barato"]);
  const words = f.split(" ").filter(Boolean);
  return words.length > 0 && words.every((w) => generic.has(w)) && words.some((w) => /^(remedios?|medicamentos?|produtos?|algo|coisa)$/.test(w));
}

/** "posso dar dipirona para meu filho?", "pode tomar com ibuprofeno?": about using a medicine, so the pharmacist's. */
/** "tem outro parecido?", "existe um similar?": comparing products is the pharmacist's call, not Alex's. */
const SIMILAR_PRODUCT_QUESTION = /^(?:e )?(?:tem|ha|existe|teria)\b.{0,14}\b(?:outro|outra|similar|parecid[oa]|equivalente|alternativa|generico)\b/;

const MEDICINE_USE_QUESTION = /\b(posso|pode|devo|da pra) (dar|tomar|misturar)\b/;

const RE = {
  cancel: /^(cancelar|cancela|cancelar pedido|cancelar tudo|desistir|desisti|deixa pra la|esquece|nao quero mais|esquece isso)$/,
  talkPharmacist: /\b(farmaceutic[oa]s?|atendente|humano|pessoa de verdade|alguem de verdade|falar com alguem|falar com uma pessoa|falar com a farmacia|responsavel tecnic[oa])\b/,
  viewCart: /\b(ver|mostrar|mostra|abrir|abre|qual|como esta|conferir)\b.{0,14}\bcarrinho\b|^carrinho$|^meu carrinho$/,
  clearCart: /\b(esvaziar|limpar|zerar)\b.{0,12}\bcarrinho\b|^(remover|remove|tirar|tira|retirar|limpar|limpa|esvaziar|esvazia)\s+(tudo|todos|todas|todos os itens|tudo isso)$/,
  checkout: /\b(finalizar|fechar|concluir|encerrar|prosseguir)\b.{0,20}\b(pedido|compra|carrinho)\b|^(finalizar|fechar pedido|continuar|prosseguir|pagar|fechar)$|\bquero finalizar\b|\bquero fechar\b/,
  removeItem: /^(remover|remove|tirar|tira|retirar|retira|excluir|exclui|apagar|apaga)\s+(?:o |a |os |as |um |uma )?(.+)/,
  changeItems: /^(alterar itens|mudar itens|editar carrinho|mudar pedido)$/,
  browseCatalog: /\b(catalogo|cardapio)\b|\b(ver|mostrar|mostra|listar|lista|conhecer)\b.{0,14}\b(produtos|catalogo|remedios|medicamentos|itens)\b|\bquais\b.{0,14}\b(produtos|remedios|medicamentos|itens)\b|\bo ?que\b.{0,3}\b(voces|vcs|voce|vc|a farmacia|a loja)?\s?(tem|temos|vendem|vende)\b(?! (pra|para|contra|de bom))/,
  startOrder: /\b(fazer|montar|iniciar|comecar|novo)\b.{0,12}\bpedido\b|^(quero )?pedir$/,
  thanks: /^(muito )?(obrigad[oa]|brigad[oa]|valeu|vlw|tchau|ate mais|ate logo|ok obrigad[oa]|certo obrigad[oa])\b/,
  orderStatus: /\b(status|acompanhar|acompanhamento|rastrear|onde esta|cade|como esta|andamento|ja saiu|chegou)\b.{0,25}\b(pedido|entrega|encomenda|compra)\b|\bmeu pedido\b/,
  purchaseVerb: /\b(quero|queria|preciso|precisava|gostaria|pedir|pedido de|comprar|adicionar|adiciona|coloca|colocar|poe|por no carrinho|me ve|me manda|manda|vou querer|levar|leva)\b/,
  hoursDay: /^(e )?(o |a |no |na |nos |nas |aos |as |de |pra |para )?(domingos?|sabados?|segundas?|tercas?|quartas?|quintas?|sextas?|feriados?|fins? de semana|finais de semana|dias? de semana|dias uteis)( feira)?( tambem)?$/,
  hours: /\b(horario|horarios|funciona|funcionam|funcionamento|abre|abrem|abrir|aberto|aberta|fecha|fecham|fechado|fechada|abertos|ate que horas|que horas)\b/,
  deliveryInfo: /\b(entrega|entregam|entregas|frete|taxa|delivery|motoboy|tempo de entrega|area de entrega|entregam em|atendem em|bairros?)\b/,
  pickupInfo: /\b(retirada|retirar|buscar na loja|buscar ai|pegar na loja|retiro)\b/,
  paymentInfo: /\b(pagamento|pagar|pix|cartao|dinheiro|forma de pagamento|formas de pagamento)\b/,
  exchangeInfo: /\b(troca|trocar|devolucao|devolver|reembolso|arrependimento)\b/,
  minOrder: /\b(pedido minimo|valor minimo|minimo de pedido|compra minima)\b/,
  fullInfo: /\b(todas|todos|tudo|completas?|gerais|geral)\b.{0,30}\b(informacoes?|infos?|dados)\b|\binformacoes (gerais|da farmacia|completas)\b|^(informacoes|infos?)$|\b(resumo|tudo) (da|sobre a) farmacia\b/,
  attendant: /\batendente\b/,
  otherProducts: /\b(ver )?outros? (produtos?|itens|remedios|opcoes)\b|\bo que mais (tem|voces tem|vende|voces vendem)\b|\bmais (produtos|opcoes)\b/,
};

@Injectable()
export class PharmacyChatService {
  private readonly logger = new Logger(PharmacyChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomerProfileService,
    @Inject(PHARMACY_ORDERS_PORT) private readonly orders: PharmacyOrdersPort,
    @Inject(PHARMACY_HANDOFFS_PORT) private readonly handoffs: PharmacyHandoffsPort,
    @Inject(PHARMACY_NOTIFIER_PORT) private readonly notifier: PharmacyNotifierPort,
    private readonly analytics: AnalyticsService,
  ) {}

  private get db(): any {
    return this.prisma.client;
  }

  private catalogFor() {
    return new PharmacyCatalog(this.prisma as any);
  }

  // -------------------------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------------------------

  /** Called by ChatService for every visitor text turn of a pharmacy. null = not handled (general question: model path). */
  async handleText(businessId: string, conversationId: string, text: string): Promise<PharmacyTurnResult | null> {
    const turn = await this.loadTurn(businessId, conversationId);
    await this.syncPrescriptions(turn);
    const handled = await this.onText(turn, text);
    if (!handled) {
      // Not ours (e.g. a general question for the model); keep any silent state change (promoted prescription, ...).
      if (turn.out.length === 0) {
        if (turn.dirty) await this.saveState(turn);
        return null;
      }
    }
    return this.finish(turn, 1);
  }

  async handleAction(businessId: string, conversationId: string, action: PharmacyAction): Promise<{ messages: any[]; pharmacy: PharmacyView; suggestions?: string[] }> {
    const turn = await this.loadTurn(businessId, conversationId);
    await this.syncPrescriptions(turn);
    // What the visitor tapped ("1–3 dias", "Concordo e quero continuar", "Adicionar Dipirona…") is part of the conversation:
    // store it as the visitor's message so a reload, a resume link or the staff view shows the full dialogue.
    const echoRaw = (action as { echo?: unknown }).echo;
    const echo = typeof echoRaw === "string" ? echoRaw.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    if (echo) {
      await this.db.message.create({ data: { conversationId: turn.conversation.id, businessId: turn.business.id, role: "visitor", content: echo } });
    }
    await this.onAction(turn, action);
    const result = await this.finish(turn, echo ? 1 : 0);
    return { messages: result.messages, pharmacy: result.pharmacy, suggestions: result.suggestions };
  }

  async getView(businessId: string, conversationId: string): Promise<PharmacyView> {
    const conversation = await this.db.conversation.findFirst({ where: { id: conversationId, businessId } });
    const state = normalizeState(conversation?.pharmacyState);
    return this.buildView(businessId, conversationId, state);
  }

  /** Fixed LGPD wording per purpose (GET /chat/:businessId/consent-text). */
  consentText(purpose: string) {
    if (purpose !== "pharmacy_triage" && purpose !== "prescription_upload" && purpose !== "order_contact" && purpose !== "pharmacy_contact") {
      throw new BadRequestException("Finalidade inválida.");
    }
    const card = consentCard(purpose);
    return { purpose: card.purpose, version: card.version, text: card.text };
  }

  // -------------------------------------------------------------------------------------------
  // Turn plumbing
  // -------------------------------------------------------------------------------------------

  private async loadTurn(businessId: string, conversationId: string): Promise<Turn> {
    const business = await this.db.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException("Business not found");
    const conversation = await this.db.conversation.findFirst({ where: { id: conversationId, businessId } });
    if (!conversation) throw new NotFoundException("Conversation not found");
    const settings = await this.catalogFor().settings(businessId);
    const mode = await loadOperationMode(this.db, businessId);
    const turn = new Turn(normalizeState(conversation.pharmacyState), business, conversation, settings, mode);
    if (mode.effective === "attendance") this.resetCommerceState(turn);
    await this.mergeLeadConsents(turn);
    return turn;
  }

  private async saveState(turn: Turn) {
    await this.db.conversation.update({ where: { id: turn.conversation.id }, data: { pharmacyState: turn.state as unknown as object } });
  }

  private async finish(turn: Turn, visitorMessages: number): Promise<PharmacyTurnResult> {
    const rows: any[] = [];
    for (const m of turn.out) {
      const row = await this.db.message.create({
        data: {
          conversationId: turn.conversation.id,
          businessId: turn.business.id,
          role: "assistant",
          content: m.text,
          answerSource: "fixed_flow",
          ...(m.ui ? { uiData: m.ui as unknown as object } : {}),
        },
      });
      rows.push(serializePharmacyMessage(row));
    }
    await this.db.conversation.update({
      where: { id: turn.conversation.id },
      data: {
        pharmacyState: turn.state as unknown as object,
        lastMessageAt: new Date(),
        messageCount: { increment: visitorMessages + rows.length },
      },
    });
    const pharmacy = await this.buildView(turn.business.id, turn.conversation.id, turn.state, turn.mode.effective);
    const suggestions = turn.mode.effective === "attendance" ? attendanceChips(turn.suggestions) : turn.suggestions;
    return { message: rows[0] ?? null, messages: rows, suggestions, pharmacy, escalated: false };
  }

  async buildView(businessId: string, conversationId: string, state: PharmacyState, knownMode?: "commerce" | "attendance"): Promise<PharmacyView> {
    const catalog = this.catalogFor();
    const operationMode = knownMode ?? (await loadOperationMode(this.db, businessId)).effective;
    // Attendance mode never shows a cart, even if an old commerce-mode state still has lines.
    const products = operationMode === "attendance" ? [] : await catalog.getMany(businessId, state.cart.map((l) => l.productId));
    const joined = await this.db.message.findMany({ where: { conversationId, kind: "human_joined" }, orderBy: { createdAt: "asc" } });
    const seen = new Set<string>();
    const humanJoined = [];
    for (const m of joined) {
      if (!m.authorMemberId || seen.has(m.authorMemberId)) continue;
      seen.add(m.authorMemberId);
      humanJoined.push({ memberId: m.authorMemberId, name: m.authorName ?? "", roleName: m.authorRole ?? "" });
    }
    return {
      operationMode,
      lane: state.lane,
      cart: buildCartDto(operationMode === "attendance" ? [] : state.cart, products),
      checkoutStep: state.checkoutStep,
      orderCode: state.order?.code ?? null,
      statusUrl: state.order?.statusUrl ?? null,
      humanJoined,
      handoffOpen: Boolean(state.handoffId || state.questionHandoffId),
    };
  }

  private track(turn: Turn, name: string, props: Record<string, unknown> = {}) {
    // Properties carry ids and enums only, never text (API.md 10.2).
    this.analytics.recordEvent(turn.business.id, name, props, turn.conversation.id, turn.state.contact.leadId ?? turn.conversation.leadId ?? undefined).catch(() => {});
  }

  // -------------------------------------------------------------------------------------------
  // Text routing
  // -------------------------------------------------------------------------------------------

  private async onText(t: Turn, rawText: string): Promise<boolean> {
    const text = rawText.trim();
    const f = fold(text);

    // 1. Red flags beat everything, in every state.
    const hit = detectRedFlag(text);
    if (hit) {
      await this.handleRedFlag(t, hit, text);
      return true;
    }

    // 2. Global exits and the pharmacist chips.
    if (RE.cancel.test(f) || f === fold(CHIPS.cancel)) {
      return this.cancelFlow(t);
    }
    if (f === fold(CHIPS.alertPharmacist) || f === fold(CHIP.talkToPharmacistNow) || f === fold(CHIPS.onlyPharmacist)) {
      await this.handoffFromChip(t, text);
      return true;
    }
    // The info chips are answered from the settings wherever the visitor is in the conversation (then the open question is repeated).
    if (INFO_CHIPS.has(f)) {
      if (!(await this.answerInfo(t, this.infoTopics(f), text))) return false;
      if (t.state.awaiting && t.state.awaiting.kind !== "product_name") await this.promptAwaiting(t, false);
      return true;
    }
    if (f === fold(CHIPS.talkAttendant) || (RE.attendant.test(f) && !/farmaceutic/.test(f) && f.split(" ").length <= 6 && !t.state.symptom?.active)) {
      this.startAttendantQuestion(t);
      return true;
    }

    // 3. Consume what the current step is waiting for.
    const consumed = await this.consumeAwaiting(t, text);
    if (consumed === "done") return true;

    // 4. Intents.
    const routed = t.mode.effective === "attendance" ? await this.routeAttendance(t, text, consumed === "invalid") : await this.routeIntent(t, text, consumed === "invalid");
    if (routed) return true;

    if (consumed === "invalid") {
      await this.promptAwaiting(t, true);
      return true;
    }
    return false;
  }

  private async routeIntent(t: Turn, text: string, midStep: boolean): Promise<boolean> {
    let f = fold(text);

    // "oi, meu nome é Marina": remember the name (never asked again) and greet back; the rest of the message, if any, goes on.
    const self = !t.state.symptom?.active && !t.state.contact.name && !t.state.contact.returningFirstName ? extractSelfName(text) : null;
    if (self) {
      t.state.contact.name = titleCaseName(self.name);
      const first = self.name.split(/\s+/)[0];
      if (fold(self.rest).split(" ").filter(Boolean).length < 2) {
        t.say(COPY.nicePrefix(titleCaseName(first)));
        t.chips(...this.quickChips(t));
        return true;
      }
      t.prefix = `Prazer, ${titleCaseName(first)}!`;
      text = self.rest;
      f = fold(text);
    }

    // Quantity typed in the chat ("quero 2", "mais um", "tira um", "só 1", "remove"): adjusts the focused / last-added line.
    if (!t.state.symptom?.active && (await this.tryQtyEdit(t, text))) return true;

    // A pharmacist suggestion is waiting: "quero comprar / quero esses / pode ser" buy THOSE products, not the generic catalog.
    if (!t.state.symptom?.active && (await this.tryBuyFromSuggestion(t, f))) return true;

    if (RE.otherProducts.test(f) || f === fold(CHIPS.otherProducts)) {
      await this.showCatalog(t, { intro: COPY.catalogIntro });
      return true;
    }
    if (f === fold(CHIPS.makeOrder) || RE.startOrder.test(f)) {
      await this.showCatalog(t, { intro: COPY.catalogIntro });
      return true;
    }
    if (!t.state.symptom?.active && f.split(" ").length <= 10 && RE.browseCatalog.test(f) && !asksRecommendation(text) && !detectsSymptomIntent(text)) {
      await this.showCatalog(t, { intro: COPY.catalogIntro, categoryText: f });
      return true;
    }
    if (RE.thanks.test(f) && f.split(" ").length <= 6) {
      t.say(`Por nada${nameComma(t.first)}! Foi um prazer ajudar. Se precisar de mais alguma coisa, estou por aqui.`);
      t.chips(CHIPS.makeOrder, CHIPS.talkPharmacist);
      return true;
    }
    // Store information (hours, delivery, pickup, payment, "todas as informações") is answered from PharmacySettings.
    if (!hasProductMention(text) && this.infoTopics(f).length > 0 && !asksRecommendation(text) && !detectsSymptomIntent(text)) {
      return this.answerInfo(t, this.infoTopics(f), text);
    }
    if (isGreeting(text)) {
      const persona = getPersona("farmacia");
      t.say(persona.welcome?.(t.business.name) ?? COPY.askProduct);
      t.chips(...this.quickChips(t));
      return true;
    }
    if (RE.clearCart.test(f) || f === fold(CHIPS.clearCart)) {
      t.state.cart = [];
      t.state.pendingRx = [];
      t.state.checkoutStep = null;
      t.state.awaiting = null;
      t.say(COPY.cartCleared);
      t.chips(CHIPS.makeOrder);
      return true;
    }
    if (RE.viewCart.test(f) || f === fold(CHIPS.viewCart) || RE.changeItems.test(f)) {
      await this.showCart(t);
      return true;
    }
    if (RE.checkout.test(f) || f === fold(CHIPS.checkout)) {
      await this.startCheckout(t);
      return true;
    }
    const remove = f.match(RE.removeItem);
    if (remove) {
      if (await this.removeByText(t, remove[2])) return true;
      // Named something that is not in the cart (and is not a product to add): say so instead of a dead end.
      if (productTokens(remove[2]).some((tok) => tok.length >= 3)) {
        if (t.state.cart.length > 0) {
          t.prefix = COPY.notInCart;
          await this.showCart(t);
        } else {
          t.say(COPY.cartEmpty);
          t.chips(CHIPS.makeOrder);
        }
        return true;
      }
    }
    if (asksForDosage(text)) {
      t.say(COPY.dosageRefusal);
      t.chips(CHIPS.talkPharmacist, CHIPS.makeOrder);
      return true;
    }
    if (RE.orderStatus.test(f) && !midStep) {
      await this.answerOrderStatus(t);
      return true;
    }
    if (RE.talkPharmacist.test(f)) {
      await this.requestPharmacist(t, text);
      return true;
    }
    // "posso dar dipirona para meu filho?": a clinical question, answered only by the pharmacist (never by Alex, never the general team).
    if (!t.state.symptom?.active && MEDICINE_USE_QUESTION.test(f) && !detectsSymptomIntent(text)) {
      await this.requestPharmacist(t, text, true);
      return true;
    }

    if (!t.state.symptom?.active && f.split(" ").length <= 8 && SIMILAR_PRODUCT_QUESTION.test(f)) {
      await this.requestPharmacist(t, text, true);
      return true;
    }

    // Add the product currently shown on the card ("Adicionar ao carrinho", "Adicionar 3", "sim").
    if (t.state.focus?.kind === "otc" && !t.state.symptom?.active) {
      const addN = f.match(/^adicionar (\d{1,2})$/);
      if (f === fold(CHIPS.addToCart) || addN || /^(adicionar|adiciona|coloca|pode adicionar|quero|quero esse|quero esse mesmo)$/.test(f)) {
        const product = await this.catalogFor().getOne(t.business.id, t.state.focus.productId);
        if (product) {
          await this.addToCart(t, product, addN ? Number(addN[1]) : 1, true);
          return true;
        }
      }
    }

    // "preciso de um remédio" / "quero um medicamento": nothing to look up yet, ask which one (warm, no catalog dump).
    if (!t.state.symptom?.active && RE.purchaseVerb.test(f) && isGenericProductAsk(f)) {
      t.say(COPY.whichProduct(t.first));
      t.chips(CHIPS.makeOrder, CHIPS.talkPharmacist);
      return true;
    }

    // Product resolution (class always from the DB row). Skipped while a symptom questionnaire runs.
    if (!t.state.symptom?.active) {
      const catalog = this.catalogFor();
      const wantsRecommendation = asksRecommendation(text);
      if (!wantsRecommendation && productTokens(text).some((tok) => tok.length >= 3)) {
        const resolution = await catalog.resolve(t.business.id, text);
        if (resolution.status !== "none") {
          await this.handleResolution(t, resolution, text);
          return true;
        }
      }
      if (detectsSymptomIntent(text)) {
        // A symptom message while a handoff is still open is extra information for that same handoff.
        if (t.state.handoffId && (await this.acknowledgeHandoffFollowUp(t, text))) return true;
        await this.startSymptomLane(t, text);
        return true;
      }
      // "quero X" where X is not in the catalog: say so (deterministic), do not hand a purchase to the model.
      if ((RE.purchaseVerb.test(f) || t.state.awaiting?.kind === "product_name") && !wantsRecommendation && !unknownStoreTopic(f) && this.looksLikeProductRequest(f)) {
        await this.showCatalog(t, { intro: COPY.catalogNotFound, fallback: COPY.notFound });
        return true;
      }
    }

    // Jokes, trivia, sports: a kind redirect, never a handoff to the team.
    if (!t.state.symptom?.active && offTopicChat(text)) {
      t.say(COPY.offTopic(t.first));
      t.chips(CHIPS.makeOrder, CHIPS.talkPharmacist, CHIPS.hoursDelivery);
      return true;
    }

    // A pharmacy question that is not a product: deterministic facts first.
    if (await this.answerGeneralFromText(t, f, text)) return true;

    // A non-clinical store question the settings never cover (holidays, promotions, parking, invoices ...): the team answers.
    if (unknownStoreTopic(f) && (looksLikeQuestion(text) || f.split(" ").length >= 2) && !clinicalQuestion(text)) {
      if (await this.kbMayAnswer(t, text)) return false;
      await this.raiseGeneralQuestion(t, text);
      return true;
    }

    // Right after a red flag: any purchase-like continuation gets the urgent reminder, never a sale.
    if (this.inRedFlagCooldown(t) && (isAffirmative(text) || RE.purchaseVerb.test(f) || f === fold(CHIPS.confirmOrder))) {
      t.say(COPY.redFlagCooldown);
      t.chips(CHIPS.talkPharmacist);
      return true;
    }

    // Follow-up on an open handoff: acknowledge instead of sending it to the model.
    if (t.state.handoffId && !t.state.symptom?.active) {
      if (await this.acknowledgeHandoffFollowUp(t, undefined, text)) return true;
    }
    return false;
  }

  /**
   * Commerce mode: the browsable catalog (confirmed OTC first, then confirmed prescription; never controlled,
   * unclassified or out-of-stock). Deterministic, no model. The visitor can still type a product name.
   */
  private async showCatalog(t: Turn, opts: { intro: string; fallback?: string; category?: string | null; categoryText?: string; offset?: number }) {
    const rows = await this.catalogFor().listable(t.business.id);
    t.state.awaiting = { kind: "product_name" };
    if (rows.length === 0) {
      t.say(opts.fallback ?? COPY.catalogEmpty);
      t.chips(CHIPS.talkPharmacist, CHIPS.hoursDelivery);
      return;
    }
    let category = opts.category ?? null;
    if (!category && opts.categoryText) {
      const ui = catalogListUi(rows, t.settings) as unknown as { categories: string[] };
      category = ui.categories.find((c) => new RegExp(`\\b${fold(c).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(opts.categoryText!)) ?? null;
    }
    t.say(opts.intro, catalogListUi(rows, t.settings, { category, offset: opts.offset }));
    t.chips(CHIPS.talkPharmacist, CHIPS.hoursDelivery);
  }

  /** A purchase sentence naming something (not a pure question about hours/delivery/etc.). */
  private looksLikeProductRequest(f: string): boolean {
    if (RE.hours.test(f) || RE.deliveryInfo.test(f) || RE.pickupInfo.test(f) || RE.paymentInfo.test(f) || RE.exchangeInfo.test(f) || RE.minOrder.test(f)) return false;
    return productTokens(f).some((tok) => tok.length >= 3 && !/^\d+$/.test(tok));
  }

  private quickChips(t: Turn): string[] {
    const configured = t.settings.quickChips.filter((c) => typeof c === "string" && c.trim());
    return configured.length > 0 ? configured.slice(0, 4) : [CHIPS.makeOrder, CHIPS.talkPharmacist, CHIPS.hoursDelivery];
  }

  // -------------------------------------------------------------------------------------------
  // Actions (structured fast path)
  // -------------------------------------------------------------------------------------------

  private async onAction(t: Turn, action: PharmacyAction) {
    const type = String(action?.type ?? "");
    if (t.mode.effective === "attendance" && COMMERCE_ACTIONS.has(type)) {
      // No catalog, cart or checkout in attendance mode (also if an old widget still sends these).
      t.say(ATT_COPY.cartAction);
      t.chips(ATT_CHIPS.askProduct, ATT_CHIPS.talkPharmacist);
      return;
    }
    switch (type) {
      case "catalog.browse": {
        const offset = Number(action.offset);
        await this.showCatalog(t, {
          intro: offset > 0 ? COPY.catalogMore : COPY.catalogIntro,
          category: typeof action.category === "string" && action.category.trim() ? action.category : null,
          offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
        });
        return;
      }
      case "product.view": {
        const product = await this.requireProduct(t, String(action.productId ?? ""));
        await this.presentProduct(t, product, 1, false);
        return;
      }
      case "cart.add": {
        const product = await this.requireProduct(t, String(action.productId ?? ""));
        await this.addToCart(t, product, toQty(action.qty), true);
        return;
      }
      case "cart.add_many": {
        await this.cartAddMany(t, action);
        return;
      }
      case "cart.set_qty": {
        await this.setQty(t, String(action.productId ?? ""), Number(action.qty));
        return;
      }
      case "cart.remove": {
        await this.setQty(t, String(action.productId ?? ""), 0);
        return;
      }
      case "cart.view": {
        await this.showCart(t);
        return;
      }
      case "cart.clear": {
        await this.routeIntent(t, "esvaziar carrinho", false);
        return;
      }
      case "rx.check": {
        await this.syncPrescriptions(t);
        // The turn may already have synced the upload before this action ran (then `out` is not empty or the
        // pending line is gone): only claim "not received" when there really is no upload for this conversation.
        if ((await this.listRxUploads(t)).length === 0) {
          t.say("Ainda não recebi a foto da receita. Assim que você enviar, eu sigo com o pedido.", await this.rxUploadUi(t, null));
        }
        return;
      }
      case "checkout.start": {
        await this.startCheckout(t);
        return;
      }
      case "checkout.contact": {
        await this.submitContact(t, {
          phone: typeof action.phone === "string" ? action.phone : undefined,
          name: typeof action.name === "string" ? action.name : undefined,
          email: typeof action.email === "string" ? action.email : undefined,
          consent: action.consent === true,
        });
        return;
      }
      case "checkout.fulfillment": {
        if (action.fulfillment !== "delivery" && action.fulfillment !== "pickup") throw new BadRequestException("fulfillment inválido");
        await this.chooseFulfillment(t, action.fulfillment);
        return;
      }
      case "checkout.use_saved_address": {
        await this.useSavedAddress(t, typeof action.addressId === "string" ? action.addressId : undefined);
        return;
      }
      case "checkout.address": {
        await this.submitAddress(t, {
          cep: String(action.cep ?? ""),
          number: String(action.number ?? ""),
          complement: typeof action.complement === "string" ? action.complement : null,
          reference: typeof action.reference === "string" ? action.reference : null,
          street: typeof action.street === "string" ? action.street : null,
          district: typeof action.district === "string" ? action.district : null,
          city: typeof action.city === "string" ? action.city : null,
          state: typeof action.state === "string" ? action.state : null,
          replaceDefault: action.replaceDefault === true,
        });
        return;
      }
      case "checkout.confirm": {
        await this.confirmOrder(t);
        return;
      }
      case "symptom.answer": {
        await this.symptomAnswerAction(t, String(action.step ?? ""), String(action.value ?? ""), action.consent === true);
        return;
      }
      case "handoff.request": {
        const reason = action.reason === "other" ? "other" : "symptom";
        if (reason === "other") await this.handoffGeneric(t, "Cliente pediu para falar com o farmacêutico.");
        else await this.requestPharmacist(t, "");
        return;
      }
      default:
        throw new BadRequestException(`Ação desconhecida: ${type}`);
    }
  }

  private async requireProduct(t: Turn, productId: string): Promise<ProductRow> {
    const product = await this.catalogFor().getOne(t.business.id, productId);
    if (!product || !product.active) throw new NotFoundException("Produto não encontrado.");
    return product;
  }

  // -------------------------------------------------------------------------------------------
  // Red flag (lane A)
  // -------------------------------------------------------------------------------------------

  private conversationLink(t: Turn) {
    return `/conversas?open=${t.conversation.id}`;
  }

  private async handleRedFlag(t: Turn, hit: RedFlagHit, text: string) {
    t.state.lane = "red_flag";
    t.state.redFlagAt = new Date().toISOString();
    t.state.checkoutStep = null;
    t.state.awaiting = null;
    t.state.pendingRx = [];
    t.state.focus = null;
    if (t.state.symptom) t.state.symptom.active = false;
    const handoff = await this.createHandoff(t, {
      reason: "symptom",
      urgent: true,
      summary: `URGENTE: ${hit.label}`,
      brief: {
        symptoms: hit.label,
        duration: "",
        severity: "urgente",
        forWhom: { relation: "", age: "" },
        allergies: [],
        otherMedicines: [],
        alreadyTried: [],
        redFlags: [hit.label],
        suggestedProducts: [],
        customerText: text.slice(0, 300),
        conversationLink: this.conversationLink(t),
      },
    });
    t.state.handoffId = handoff?.id ?? t.state.handoffId ?? null;
    this.track(t, "pharmacy_red_flag", {});
    t.say(redFlagReplyText(hit), {
      type: "red_flag",
      headline: "Isso pode ser urgente",
      body: hit.kind === "self_harm" ? `Ligue ${SAMU_NUMBER} (SAMU) ou ${CVV_NUMBER} (CVV) agora.` : `Ligue ${SAMU_NUMBER} (SAMU) ou vá ao pronto-socorro agora.`,
      samuNumber: SAMU_NUMBER,
      offerPharmacist: true,
      handoffId: handoff?.id ?? null,
    });
    t.chips(CHIPS.alertPharmacist);
  }

  private inRedFlagCooldown(t: Turn): boolean {
    const at = t.state.redFlagAt ? Date.parse(t.state.redFlagAt) : NaN;
    return Number.isFinite(at) && Date.now() - at < RED_FLAG_COOLDOWN_MS;
  }

  // -------------------------------------------------------------------------------------------
  // Handoffs (pharmacist) — brief only ever goes into PharmacistHandoff.brief
  // -------------------------------------------------------------------------------------------

  private async createHandoff(
    t: Turn,
    input: { reason: CreateHandoffInput["reason"]; urgent: boolean; summary: string; brief: Record<string, unknown> },
  ): Promise<{ id: string } | null> {
    try {
      const created = await this.handoffs.create({
        businessId: t.business.id,
        conversationId: t.conversation.id,
        leadId: t.state.contact.leadId ?? t.conversation.leadId,
        ...input,
      });
      if (!created.reused) {
        this.track(t, "pharmacy_handoff_created", { handoffId: created.id, reason: input.reason, urgent: input.urgent });
        await this.notifier.notify({ type: "new_handoff", businessId: t.business.id, handoffId: created.id, urgent: input.urgent, reason: input.reason });
      }
      return { id: created.id };
    } catch (error) {
      this.logger.error(`handoff creation failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async handoffFromChip(t: Turn, text: string) {
    const f = fold(text);
    if (t.state.lane === "red_flag" && this.inRedFlagCooldown(t)) {
      t.say(`Pronto${nameComma(t.first)}, já avisei ${pharmacistRef(t.settings.pharmacistName)}; assim que responder, te mostro aqui. Enquanto isso, se piorar ou for urgente, ligue 192 (SAMU).`);
      return;
    }
    if (t.state.focus && t.state.focus.kind !== "otc") {
      await this.handoffForFocus(t);
      return;
    }
    if (f === fold(CHIPS.onlyPharmacist) || t.state.awaiting?.kind === "symptom_consent") {
      t.state.awaiting = null;
      if (t.state.symptom) t.state.symptom.active = false;
      await this.handoffGeneric(t, "Cliente pediu para falar com o farmacêutico.");
      return;
    }
    await this.handoffGeneric(t, "Cliente pediu para falar com o farmacêutico.");
  }

  private async handoffForFocus(t: Turn) {
    const focus = t.state.focus!;
    const product = await this.catalogFor().getOne(t.business.id, focus.productId);
    if (!product) {
      await this.handoffGeneric(t, "Cliente pediu para falar com o farmacêutico.");
      return;
    }
    const label = productLabel(product);
    let reason: "controlled" | "out_of_stock" | "other" = "other";
    let brief: Record<string, unknown>;
    if (focus.kind === "out_of_stock") {
      const equivalents = t.state.equivalentOffer?.forProductId === product.id ? await this.catalogFor().getMany(t.business.id, t.state.equivalentOffer.ids) : [];
      reason = "out_of_stock";
      brief = {
        requestedProduct: label,
        medication: label,
        stock: product.stockQty ?? 0,
        availability: "Sem estoque",
        equivalents: equivalents.map((e) => ({ productId: e.id, name: productLabel(e), stockQty: e.stockQty, priceCents: e.priceCents })),
        customerRequest: "Cliente pediu o produto e ele está sem estoque.",
        conversationLink: this.conversationLink(t),
      };
    } else {
      reason = product.saleClass === "controlled" ? "controlled" : "other";
      brief = {
        medication: label,
        availability: inStock(product) ? "Em estoque" : "Sem estoque ou não confirmado",
        priceInformedCents: product.priceCents,
        onlineSaleAllowed: false,
        customerRequest: focus.kind === "pharmacist_required" ? "Produto exige confirmação do farmacêutico antes do pedido." : "Cliente quer comprar um item que não é vendido online.",
        conversationLink: this.conversationLink(t),
      };
    }
    const handoff = await this.createHandoff(t, { reason, urgent: false, summary: `${label}`.slice(0, 80), brief });
    t.state.handoffId = handoff?.id ?? t.state.handoffId ?? null;
    t.say(COPY.handoffOtherDone);
    t.chips(CHIPS.makeOrder, CHIPS.hoursDelivery);
  }

  private async handoffGeneric(t: Turn, customerRequest: string) {
    const handoff = await this.createHandoff(t, {
      reason: "other",
      urgent: false,
      summary: "Cliente pediu o farmacêutico",
      brief: { customerRequest, conversationLink: this.conversationLink(t) },
    });
    t.state.handoffId = handoff?.id ?? t.state.handoffId ?? null;
    t.state.lane = t.state.lane ?? "general";
    t.say(COPY.handoffOtherDone);
    t.chips(CHIPS.makeOrder, CHIPS.hoursDelivery);
  }

  private async requestPharmacist(t: Turn, text: string, medicineQuestion = false) {
    if (t.state.focus && t.state.focus.kind !== "otc") {
      await this.handoffForFocus(t);
      return;
    }
    await this.startSymptomLane(t, text, medicineQuestion);
  }

  private async acknowledgeHandoffFollowUp(t: Turn, followUpText?: string, messageText?: string): Promise<boolean> {
    const handoff = await this.db.pharmacistHandoff.findFirst({ where: { id: t.state.handoffId, businessId: t.business.id } });
    if (!handoff || handoff.status === "closed") {
      t.state.handoffId = null;
      t.dirty = true;
      return false;
    }
    const data: Record<string, unknown> = {};
    if (handoff.status === "answered") data.status = "open"; // a new customer message re-opens an answered handoff (API.md 2.3)
    if (followUpText) {
      // Extra information goes to the pharmacist's brief only, never into a customer-visible message.
      const brief = (handoff.brief && typeof handoff.brief === "object" ? handoff.brief : {}) as Record<string, unknown>;
      const followUps = Array.isArray(brief.followUps) ? (brief.followUps as string[]) : [];
      data.brief = { ...brief, followUps: [...followUps, followUpText.slice(0, 300)].slice(-5) };
    }
    if (Object.keys(data).length > 0) await this.db.pharmacistHandoff.update({ where: { id: handoff.id }, data });
    const humanPresent = (await this.db.message.count({ where: { conversationId: t.conversation.id, kind: "human_joined" } })) > 0;
    const waiting = (followUpText ?? messageText) ? /\b(ja respond\w*|respondeu|responderam|demor\w*|cade|ainda nao|quando|esperando|aguardando|sem resposta|nada ainda)\b/.test(fold(followUpText ?? messageText ?? "")) : false;
    const ref = pharmacistRef(t.settings.pharmacistName);
    t.say(
      humanPresent
        ? "Anotado, obrigado! O farmacêutico já vê sua mensagem e responde por aqui."
        : waiting
          ? `Entendo a espera${nameComma(t.first)}, obrigado pela paciência. Já avisei ${ref}; assim que responder, aparece aqui. Se piorar ou ficar urgente, ligue 192 (SAMU).`
          : `Anotei${nameComma(t.first)}, obrigado! Já avisei ${ref}, e a resposta vem por aqui.`,
    );
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Symptom lane (E): one question per turn, then a handoff. NEVER a product or dose in customer text.
  // -------------------------------------------------------------------------------------------

  private async startSymptomLane(t: Turn, text: string, medicineQuestion = false) {
    t.state.lane = "symptom";
    t.state.focus = null;
    const isSymptomText = detectsSymptomIntent(text) || medicineQuestion;
    t.state.symptom = {
      active: false,
      consent: false,
      step: "symptom",
      answers: {},
      pendingText: isSymptomText ? text.slice(0, 300) : undefined,
      ...(medicineQuestion ? { medQuestion: true } : {}),
      ...(!isSymptomText ? { directRequest: true } : {}),
      startedAt: new Date().toISOString(),
    };
    // What the first message already says (who, age, how long) is recorded now so it is never asked again.
    if (isSymptomText) {
      const inferred = inferFromSymptomText(text);
      const answers = { ...t.state.symptom.answers, ...inferred };
      if (answers.age && !validateAge(answers, answers.age).ok) delete answers.age;
      t.state.symptom.answers = answers;
    }
    this.track(t, "pharmacy_symptom_started", {});
    // Ask once, remember: a visitor (or recognized lead) who already granted the health-data notice is not asked again.
    if (this.hasConsent(t, "pharmacy_triage")) {
      await this.grantSymptomConsent(t, true, false);
      return;
    }
    t.state.awaiting = { kind: "symptom_consent" };
    this.symptomConsentPrompt(t, false);
  }

  private symptomConsentPrompt(t: Turn, retry: boolean) {
    const who = t.state.symptom?.answers.forWhom;
    const patient = !who || who === "Para mim" ? "self" : patientOf(t.state.symptom!.answers) === "adult" ? "adult" : patientOf(t.state.symptom!.answers);
    const sy = t.state.symptom!;
    const intro = sy.medQuestion ? COPY.medQuestionIntro(t.first) : sy.directRequest ? COPY.directPharmacistIntro(t.first, pharmacistRef(t.settings.pharmacistName)) : symptomIntroFor(patient);
    const text = retry ? COPY.symptomConsentRetry : `${intro} ${COPY.symptomConsentAsk}`;
    t.say(text, {
      type: "symptom_question",
      step: "symptom",
      prompt: COPY.symptomConsentAsk,
      chips: [CHIP.consentYes, CHIPS.onlyPharmacist],
      allowFreeText: false,
      consent: consentCard("pharmacy_triage"),
    });
    t.chips(CHIP.consentYes, CHIPS.onlyPharmacist);
  }

  private async grantSymptomConsent(t: Turn, askNext = true, record = true) {
    const s = t.state.symptom!;
    s.consent = true;
    s.active = true;
    if (record) await this.recordConsent(t, ["pharmacy_triage"]);
    if (!askNext) return;
    if (s.pendingText) {
      s.answers = recordAnswer(s.answers, "symptom", s.pendingText);
      s.pendingText = undefined;
      const ns = nextStep("symptom", s.answers);
      if (ns !== "done") {
        s.step = ns;
        await this.askSymptomStep(t);
        return;
      }
    }
    s.step = "symptom";
    await this.askSymptomStep(t);
  }

  private async askSymptomStep(t: Turn) {
    const s = t.state.symptom!;
    const p = stepPrompt(s.step, s.answers);
    t.state.awaiting = { kind: "symptom_answer", step: s.step };
    t.say(p.prompt, { type: "symptom_question", step: p.step, prompt: p.prompt, chips: p.chips, allowFreeText: p.allowFreeText, consent: null });
    t.chips(...p.chips);
  }

  private async answerSymptom(t: Turn, step: SymptomStep, value: string) {
    const s = t.state.symptom!;
    if (needsDetail(step, value)) {
      t.say(detailPrompt(step), { type: "symptom_question", step, prompt: detailPrompt(step), chips: [], allowFreeText: true, consent: null });
      t.state.awaiting = { kind: "symptom_answer", step };
      return;
    }
    // The customer volunteered the patient's age while another question was open ("ele tem 5 anos"): record it now,
    // keep the open question, and never ask the age again.
    if (step !== "age" && !s.answers.age && s.answers.forWhom) {
      const f = fold(value);
      const m = f.match(/\b(\d{1,3}) (anos?|meses)\b/);
      if (m && f.split(" ").length <= 6 && (m[2].startsWith("an") || (step !== "duration" && /\b(tem|idade)\b/.test(f)))) {
        const age = `${m[1]} ${m[2].startsWith("an") ? (m[1] === "1" ? "ano" : "anos") : m[1] === "1" ? "mês" : "meses"}`;
        if (validateAge(s.answers, age).ok) {
          s.answers = recordAnswer(s.answers, "age", age);
          if (isInfantWithFever(age, s.answers.symptom)) {
            await this.handleRedFlag(t, { kind: "infant_fever", label: "Febre em bebê" }, `${s.answers.symptom ?? ""}`);
            return;
          }
          t.prefix = "Anotei a idade, obrigada!";
          await this.askSymptomStep(t);
          return;
        }
      }
    }
    if (step === "age") {
      // A typed age that cannot belong to the chosen patient is asked again (the chips are the patient's own ranges).
      const check = validateAge(s.answers, value);
      if (!check.ok) {
        const p = stepPrompt("age", s.answers);
        t.state.awaiting = { kind: "symptom_answer", step: "age" };
        t.say(check.message, { type: "symptom_question", step: "age", prompt: p.prompt, chips: p.chips, allowFreeText: true, consent: null });
        t.chips(...p.chips);
        return;
      }
    }
    s.answers = recordAnswer(s.answers, step, value);
    // Infant + fever is an emergency regardless of the earlier "Leve".
    if ((step === "age" || step === "for_whom") && isInfantWithFever(step === "age" ? s.answers.age : s.answers.forWhom, s.answers.symptom)) {
      await this.handleRedFlag(t, { kind: "infant_fever", label: "Febre em bebê" }, `${s.answers.symptom ?? ""}`);
      return;
    }
    const ns = nextStep(step, s.answers);
    if (ns === "done") {
      await this.finalizeSymptom(t);
      return;
    }
    s.step = ns;
    await this.askSymptomStep(t);
  }

  private async symptomAnswerAction(t: Turn, step: string, value: string, consent: boolean) {
    if (!t.state.symptom) {
      await this.startSymptomLane(t, "");
    }
    const s = t.state.symptom!;
    // The consent card's own chips travel as answers of step "symptom": they are decisions, never symptom text.
    const decision = fold(value);
    if (!s.consent && decision === fold(CHIPS.onlyPharmacist)) {
      t.state.awaiting = null;
      s.active = false;
      await this.handoffGeneric(t, "Cliente pediu para falar com o farmacêutico.");
      return;
    }
    if (!s.consent && decision === fold(CHIP.consentYes)) {
      if (!consent) {
        this.symptomConsentPrompt(t, true);
        return;
      }
      await this.grantSymptomConsent(t);
      return;
    }
    if (!s.consent) {
      if (!consent) {
        this.symptomConsentPrompt(t, true);
        return;
      }
      await this.grantSymptomConsent(t, !value);
      if (!value) return;
    }
    if (t.state.awaiting?.kind === "symptom_phone" || t.state.awaiting?.kind === "symptom_name") {
      this.askSymptomPhone(t, false);
      return;
    }
    if (!value) {
      await this.askSymptomStep(t);
      return;
    }
    const hit = detectRedFlag(value);
    if (hit) {
      await this.handleRedFlag(t, hit, value);
      return;
    }
    if (step !== s.step) {
      await this.askSymptomStep(t);
      return;
    }
    await this.answerSymptom(t, s.step, value);
  }

  private async finalizeSymptom(t: Turn) {
    const s = t.state.symptom!;
    // Explicit contact step BEFORE the handoff: the pharmacist may continue on WhatsApp. Declining keeps the web-chat-only path.
    if (!s.contactAsked && !t.state.contact.leadId && !t.conversation.leadId && !t.state.contact.phone) {
      s.contactAsked = true;
      this.askSymptomPhone(t, false);
      return;
    }
    const contact = await this.symptomBriefContact(t);
    const catalog = this.catalogFor();
    let suggestions: ReturnType<typeof filterSuggestions> = [];
    try {
      // Attendance mode has no catalog: no stock-based suggestions for the pharmacist either.
      const candidates = t.mode.effective === "attendance" ? [] : await catalog.searchOtcInStock(t.business.id, suggestionKeywords(s.answers.symptom ?? ""));
      suggestions = filterSuggestions(candidates, s.answers);
    } catch (error) {
      this.logger.warn(`pharmacist suggestions skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
    const brief = buildSymptomBrief(s.answers, suggestions, { conversationId: t.conversation.id, contact });
    const handoff = await this.createHandoff(t, { reason: "symptom", urgent: false, summary: summaryLine(s.answers), brief });
    t.state.handoffId = handoff?.id ?? t.state.handoffId ?? null;
    s.active = false;
    t.state.awaiting = null;
    t.state.lane = "symptom";
    const terms = await catalog.forbiddenTerms(t.business.id).catch(() => [] as string[]);
    const ref = pharmacistRef(t.settings.pharmacistName);
    const doneText = contact?.phoneMasked
      ? `Obrigado por me contar${nameComma(t.first)}. Já passei tudo para ${ref}; ela(e) responde por aqui ou te chama no WhatsApp assim que puder.`
      : `Obrigado por me contar${nameComma(t.first)}. Já passei tudo para ${ref}; assim que responder, aparece aqui na conversa. Se piorar ou ficar urgente, ligue 192 (SAMU).`;
    const safe = guardSymptomLaneText(doneText.replace("ela(e)", /^a /.test(ref) ? "ela" : "ele"), terms);
    t.say(safe.text);
    t.chips(CHIPS.makeOrder, CHIPS.hoursDelivery);
  }

  // ---- contact step of the symptom lane (WhatsApp hand-over) ----

  private askSymptomPhone(t: Turn, invalid: boolean) {
    t.state.awaiting = { kind: "symptom_phone" };
    t.say(invalid ? COPY.badPhone : COPY.symptomAskPhone, {
      type: "contact_capture",
      purpose: "pharmacy_triage",
      fields: ["phone", "name"],
      recognized: null,
      consent: this.hasConsent(t, "pharmacy_contact") ? null : consentCard("pharmacy_contact"),
    });
    t.chips(CHIP.chatOnly);
  }

  private async symptomBriefContact(t: Turn): Promise<{ firstName: string | null; phoneMasked: string | null } | null> {
    const leadId = t.state.contact.leadId ?? t.conversation.leadId;
    if (!leadId) return null;
    const lead = await this.loadLead(t, leadId).catch(() => null);
    if (!lead) return null;
    return { firstName: firstName(lead.name), phoneMasked: maskPhoneBr(lead.phoneNormalized || lead.phone) };
  }

  /** Phone (typed or from the contact card) -> recognize the returning customer or ask the optional name. */
  private async symptomContact(t: Turn, input: { phone?: string; name?: string }) {
    const c = t.state.contact;
    if (t.state.awaiting?.kind === "symptom_phone") {
      const canonical = input.phone ? canonicalPhone(input.phone) : null;
      if (!canonical || !input.phone || pickDigits(input.phone).length < 10) {
        this.askSymptomPhone(t, !!input.phone);
        return;
      }
      c.phone = canonical;
      const lead = await this.db.lead.findFirst({ where: { businessId: t.business.id, phoneNormalized: canonical } });
      if (lead) {
        c.leadId = lead.id;
        c.name = lead.name ?? c.name;
        c.returningFirstName = firstName(lead.name) ?? undefined;
        await this.db.lead.update({ where: { id: lead.id }, data: { lastSeenAt: new Date(), sessionCount: { increment: 1 } } }).catch(() => undefined);
        await this.db.conversation.update({ where: { id: t.conversation.id }, data: { leadId: lead.id } }).catch(() => undefined);
        if (c.returningFirstName) t.prefix = `Oi, ${c.returningFirstName}! Que bom te ver de novo.`;
        await this.recordConsent(t, ["pharmacy_triage", "contact"]);
        await this.finalizeSymptom(t);
        return;
      }
      const typedName = input.name?.replace(/\s+/g, " ").trim();
      if (typedName && typedName.length >= 2 && typedName.length <= 80 && !/[0-9@]/.test(typedName)) c.name = titleCaseName(typedName);
      if (!c.name) {
        t.state.awaiting = { kind: "symptom_name" };
        t.say(COPY.symptomAskName);
        t.chips(CHIP.skipName);
        return;
      }
    } else if (input.name?.trim()) {
      c.name = titleCaseName(input.name.replace(/\s+/g, " ").trim().slice(0, 80));
    }
    await this.createSymptomLead(t);
    await this.finalizeSymptom(t);
  }

  /** Creates the Lead (phone normalized, optional name) and records the contact consent. */
  private async createSymptomLead(t: Turn, purposes: string[] = ["pharmacy_triage", "contact"]) {
    const c = t.state.contact;
    const phoneNormalized = c.phone!;
    let lead = await this.db.lead.findFirst({ where: { businessId: t.business.id, phoneNormalized } });
    if (!lead) {
      try {
        lead = await this.db.lead.create({ data: { businessId: t.business.id, name: c.name ?? null, phone: phoneNormalized, phoneNormalized } });
      } catch (error) {
        if ((error as { code?: string }).code !== "P2002") throw error;
        lead = await this.db.lead.findFirst({ where: { businessId: t.business.id, phoneNormalized } });
      }
    }
    c.leadId = lead.id;
    t.state.awaiting = null;
    await this.recordConsent(t, purposes);
    await this.db.conversation.update({ where: { id: t.conversation.id }, data: { leadId: lead.id } }).catch(() => undefined);
  }

  /** The customer prefers the web chat only: keep the old path (handoff without a phone). */
  private async declineSymptomContact(t: Turn) {
    const s = t.state.symptom;
    if (s) s.contactDeclined = true;
    t.state.awaiting = null;
    await this.finalizeSymptom(t);
  }

  private async cancelFlow(t: Turn): Promise<boolean> {
    if (t.state.awaiting?.kind === "symptom_phone" || t.state.awaiting?.kind === "symptom_name") {
      await this.declineSymptomContact(t);
      return true;
    }
    if (t.state.awaiting?.kind === "question_phone" || t.state.awaiting?.kind === "question_name" || t.state.awaiting?.kind === "attendant_question") {
      this.declineQuestionContact(t);
      return true;
    }
    if (t.state.symptom?.active || t.state.awaiting?.kind === "symptom_consent") {
      if (t.state.symptom) t.state.symptom.active = false;
      t.state.awaiting = null;
      t.say("Tudo bem, parei por aqui. Se precisar do farmacêutico, é só me chamar, estou à disposição.");
      t.chips(CHIPS.talkPharmacist, CHIPS.makeOrder);
      return true;
    }
    if (t.state.checkoutStep && t.state.checkoutStep !== "done") {
      this.track(t, "pharmacy_checkout_abandoned", { step: t.state.checkoutStep });
      t.state.checkoutStep = null;
      t.state.awaiting = null;
      t.say(t.state.cart.length > 0 ? "Tudo bem, parei a finalização. Seu carrinho continua salvo." : "Tudo bem, parei por aqui.");
      t.chips(...(t.state.cart.length > 0 ? [CHIPS.checkout, CHIPS.viewCart] : [CHIPS.makeOrder]));
      return true;
    }
    t.state.awaiting = null;
    t.say("Sem problema! Quando precisar, é só me chamar.");
    t.chips(CHIPS.makeOrder, CHIPS.talkPharmacist);
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Consent + lead helpers
  // -------------------------------------------------------------------------------------------

  /** Purposes the visitor already granted (this conversation, or their recognized lead). Never asked twice. */
  private hasConsent(t: Turn, purpose: string): boolean {
    return Boolean(t.state.consents?.includes(purpose));
  }

  private grantConsent(t: Turn, ...purposes: string[]) {
    const canonical = purposes.map((p) => CONSENT_CANONICAL[p] ?? p);
    const set = new Set([...(t.state.consents ?? []), ...canonical]);
    if (set.size !== (t.state.consents ?? []).length) {
      t.state.consents = [...set];
      t.dirty = true;
    }
  }

  /** A recognized lead brings the consents it granted in earlier conversations. */
  private async mergeLeadConsents(t: Turn) {
    const leadId = t.state.contact.leadId ?? t.conversation.leadId;
    if (!leadId) return;
    try {
      const rows: Array<{ purposes: string[] }> = await this.db.consentRecord.findMany({ where: { businessId: t.business.id, leadId, withdrawnAt: null } });
      for (const row of rows) this.grantConsent(t, ...(row.purposes ?? []));
    } catch {
      // consent memory is a convenience: asking again is the safe fallback
    }
  }

  private async recordConsent(t: Turn, purposes: string[]) {
    try {
      const seed = t.state.contact.phone ?? `anon:${t.conversation.id}`;
      await this.db.consentRecord.create({
        data: {
          businessId: t.business.id,
          leadId: t.state.contact.leadId ?? t.conversation.leadId ?? null,
          phoneHash: createHash("sha256").update(seed).digest("hex"),
          consentTextVersion: CONSENT_VERSION,
          purposes,
        },
      });
      this.grantConsent(t, ...purposes);
    } catch (error) {
      this.logger.warn(`consent record failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Awaited input
  // -------------------------------------------------------------------------------------------

  private async consumeAwaiting(t: Turn, text: string): Promise<"done" | "invalid" | "skip"> {
    const aw = t.state.awaiting;
    if (!aw) return "skip";
    const f = fold(text);
    switch (aw.kind) {
      case "product_name":
      case "qty":
        return "skip";

      case "product_request":
        return this.consumeProductRequest(t, text);

      case "product_request_consent":
        return this.consumeProductRequestConsent(t, text);

      case "symptom_consent": {
        if (isAffirmative(text) || f === fold(CHIP.consentYes)) {
          await this.grantSymptomConsent(t);
          return "done";
        }
        if (isNegative(text)) {
          t.state.awaiting = null;
          if (t.state.symptom) t.state.symptom.active = false;
          t.say("Tudo bem, não vou registrar nada. Se preferir, posso chamar o farmacêutico direto.");
          t.chips(CHIPS.onlyPharmacist, CHIPS.makeOrder);
          return "done";
        }
        // A different question typed while the consent card is open ("vocês aceitam convênio?") is answered; it is not a
        // "no", and the consent stays pending for the next "sim". Never "é você quem decide" for a plain question.
        if (looksLikeQuestion(text) && !clinicalQuestion(text) && !detectsSymptomIntent(text) && !asksForDosage(text)) return "skip";
        return "invalid";
      }

      case "symptom_answer": {
        if (!t.state.symptom?.active) return "skip";
        if (RE.talkPharmacist.test(f) && f.split(" ").length <= 8) {
          // "quero falar com o farmacêutico" mid-questionnaire: hand off with what we have so far.
          await this.finalizeSymptom(t);
          return "done";
        }
        if (!text.trim()) return "invalid";
        await this.answerSymptom(t, aw.step, text);
        return "done";
      }

      case "symptom_phone": {
        if (f === fold(CHIP.chatOnly) || isNegative(text) || /\b(so pelo chat|so aqui|prefiro (o )?chat|nao quero informar|prefiro nao)\b/.test(f)) {
          await this.declineSymptomContact(t);
          return "done";
        }
        const phone = canonicalPhone(text);
        if (!phone || pickDigits(text).length < 10) return "invalid";
        await this.symptomContact(t, { phone: text.trim() });
        return "done";
      }

      case "symptom_name": {
        const typed = text.replace(/\s+/g, " ").trim();
        if (f === fold(CHIP.skipName) || isNegative(text) || /^(pular|sem nome|prefiro nao)$/.test(f)) {
          await this.createSymptomLead(t);
          await this.finalizeSymptom(t);
          return "done";
        }
        if (typed.length < 2 || typed.length > 80 || /[0-9@]/.test(typed) || typed.split(" ").length > 6) return "invalid";
        t.state.contact.name = titleCaseName(typed);
        await this.createSymptomLead(t);
        await this.finalizeSymptom(t);
        return "done";
      }

      case "rx_upload": {
        if (f === fold(CHIPS.uploadedRx) || /\b(enviei|mandei|anexei|subi)\b.{0,20}\breceita\b/.test(f)) {
          t.say("Ainda não recebi a foto da receita. Toque em \"Tirar foto\" ou \"Escolher arquivo\" para enviar.", await this.rxUploadUi(t, null));
          t.chips(CHIPS.talkPharmacist, CHIPS.uploadedRx);
          return "done";
        }
        return "skip";
      }

      case "phone": {
        const phone = canonicalPhone(text);
        if (!phone || pickDigits(text).length < 10) return "invalid";
        await this.setPhone(t, text.trim(), phone);
        return "done";
      }

      case "name": {
        const name = text.replace(/\s+/g, " ").trim();
        if (name.length < 2 || name.length > 80 || /[0-9@]/.test(name) || name.split(" ").length > 6) return "invalid";
        t.state.contact.name = titleCaseName(name);
        await this.advanceContact(t);
        return "done";
      }

      case "email": {
        if (f === fold(CHIPS.skipEmail) || isNegative(text) || /^(pular|sem email|nao tenho)$/.test(f)) {
          t.state.contact.emailSkipped = true;
          await this.advanceContact(t);
          return "done";
        }
        if (!isValidEmail(text)) return "invalid";
        t.state.contact.email = text.trim().toLowerCase();
        await this.advanceContact(t);
        return "done";
      }

      case "contact_consent": {
        if (isAffirmative(text) || f === fold(CHIPS.consentAgree)) {
          t.state.contact.consent = true;
          await this.advanceContact(t);
          return "done";
        }
        if (isNegative(text)) {
          // Declining never switches to pickup by itself: the options are explained and the question stays open.
          t.say(COPY.consentDeclined);
          t.chips(CHIPS.consentAgree, CHIPS.talkPharmacist, CHIPS.viewCart);
          return "done";
        }
        return "invalid";
      }

      case "attendant_question": {
        const info = this.infoTopics(f);
        if (clinicalQuestion(text) || detectsSymptomIntent(text) || asksForDosage(text) || (info.length > 0 && !hasProductMention(text)) || !text.trim()) {
          t.state.awaiting = null;
          return "skip";
        }
        t.state.awaiting = null;
        // The knowledge base answers first; only a truly unknown question reaches the team.
        if (await this.kbMayAnswer(t, text)) return "skip";
        await this.raiseGeneralQuestion(t, text);
        return "done";
      }

      case "question_phone": {
        if (f === fold(CHIP.chatOnly) || isNegative(text) || /\b(so pelo chat|so aqui|prefiro (o )?chat|nao quero informar|prefiro nao)\b/.test(f)) {
          this.declineQuestionContact(t);
          return "done";
        }
        const phone = canonicalPhone(text);
        // Something that is clearly not a phone number (a new question, a product, a greeting) moves on: the phone is
        // never re-asked over it, and the customer is never told "that number is incomplete" for a sentence.
        if (pickDigits(text).length < 5) {
          t.state.awaiting = null;
          return "skip";
        }
        if (!phone || pickDigits(text).length < 10) return "invalid";
        await this.questionContact(t, { phone: text.trim() });
        return "done";
      }

      case "question_name": {
        const typed = text.replace(/\s+/g, " ").trim();
        if (f === fold(CHIP.skipName) || isNegative(text) || /^(pular|sem nome|prefiro nao)$/.test(f)) {
          await this.createSymptomLead(t, ["pharmacy_contact", "contact"]);
          await this.attachQuestionContact(t);
          return "done";
        }
        if (typed.length < 2 || typed.length > 80 || /[0-9@]/.test(typed) || typed.split(" ").length > 6) return "invalid";
        t.state.contact.name = titleCaseName(typed);
        await this.createSymptomLead(t, ["pharmacy_contact", "contact"]);
        await this.attachQuestionContact(t);
        return "done";
      }

      case "saved_address": {
        if (f === fold(CHIPS.savedOk) || isAffirmative(text)) {
          await this.useSavedAddress(t);
          return "done";
        }
        if (f === fold(CHIPS.savedUpdate) || isNegative(text) || /\b(atualizar|outro|mudar|trocar|novo)\b/.test(f)) {
          t.state.addressDraft = { replaceDefault: true };
          await this.askCep(t);
          return "done";
        }
        return "invalid";
      }

      case "cep": {
        if (f === fold(CHIPS.otherAddress)) return "invalid";
        const cep = normalizeCep(text);
        if (!cep) return "invalid";
        await this.lookupCepStep(t, cep);
        return "done";
      }

      case "street_manual": {
        const parsed = parseManualAddress(text, t.state.addressDraft ?? {});
        if (!parsed) return "invalid";
        t.state.addressDraft = { ...t.state.addressDraft, ...parsed, manual: true, needsStreet: false };
        await this.askNumber(t);
        return "done";
      }

      case "number": {
        try {
          const number = normalizeAddressNumber(text);
          t.state.addressDraft = { ...t.state.addressDraft, number };
        } catch (error) {
          if (error instanceof InvalidAddressNumberError) {
            t.say(error.message);
            t.chips("Sem número");
            return "done";
          }
          throw error;
        }
        t.state.awaiting = { kind: "complement" };
        t.say(COPY.askComplement, { type: "address_capture", saved: null, askConfirmSaved: false, fields: ["complement"], numberHint: "" });
        t.chips(CHIPS.noComplement);
        return "done";
      }

      case "complement": {
        const skip = f === fold(CHIPS.noComplement) || isNegative(text) || /^(sem|nenhum|nao tem|n a|na)$/.test(f);
        t.state.addressDraft = { ...t.state.addressDraft, complement: skip ? null : text.trim().slice(0, 60) };
        t.state.awaiting = { kind: "reference" };
        t.say(COPY.askReference, { type: "address_capture", saved: null, askConfirmSaved: false, fields: ["reference"], numberHint: "" });
        t.chips(CHIPS.noReference);
        return "done";
      }

      case "reference": {
        const skip = f === fold(CHIPS.noReference) || isNegative(text) || /^(sem|nenhum|nao tem|n a|na)$/.test(f);
        t.state.addressDraft = { ...t.state.addressDraft, reference: skip ? null : text.trim().slice(0, 120) };
        await this.submitDraftAddress(t);
        return "done";
      }

      case "fulfillment": {
          if (f === fold(CHIPS.otherAddress)) {
            t.state.fulfillment = "delivery";
            t.state.knownAddress = null;
            t.state.addressDraft = {};
            await this.askCep(t);
            return "done";
          }
          if (/\b(entreg\w*|delivery|motoboy)\b/.test(f) && !/\bretir/.test(f)) {
            await this.chooseFulfillment(t, "delivery");
            return "done";
          }
          if (/\b(retir\w*|buscar|pegar|loja|balcao)\b/.test(f)) {
            await this.chooseFulfillment(t, "pickup");
            return "done";
          }
          return "invalid";
      }

      case "order_confirm": {
        if (f === fold(CHIPS.confirmOrder) || isAffirmative(text)) {
          await this.confirmOrder(t);
          return "done";
        }
        if (f === fold(CHIPS.otherAddress) && t.state.fulfillment === "delivery") {
          t.state.knownAddress = null;
          t.state.address = undefined;
          t.state.addressMasked = false;
          t.state.addressDraft = {};
          await this.askCep(t);
          return "done";
        }
        return "invalid";
      }
    }
  }

  private async promptAwaiting(t: Turn, invalid: boolean) {
    const aw: Awaiting | null = t.state.awaiting;
    if (!aw) return;
    switch (aw.kind) {
      case "symptom_phone":
        this.askSymptomPhone(t, invalid);
        return;
      case "symptom_name":
        t.say(COPY.symptomAskName);
        t.chips(CHIP.skipName);
        return;
      case "phone":
        t.say(invalid ? COPY.badPhone : COPY.askPhone, this.contactUi(t));
        return;
      case "name":
        t.say(COPY.askName, this.contactUi(t));
        return;
      case "email":
        t.say(invalid ? COPY.badEmail : COPY.askEmail, this.contactUi(t));
        t.chips(CHIPS.skipEmail);
        return;
      case "contact_consent":
        this.askContactConsent(t);
        return;
      case "saved_address":
        await this.askSavedAddress(t);
        return;
      case "cep":
        t.say(invalid ? COPY.badCep : COPY.askCep, this.addressUi(null));
        return;
      case "street_manual":
        t.say(t.state.addressDraft?.needsStreet ? COPY.askStreetOnly : COPY.badManualAddress);
        return;
      case "number":
        t.say(COPY.askNumber, this.addressUi(null, ["number"]));
        t.chips("Sem número");
        return;
      case "complement":
        t.say(COPY.askComplement);
        t.chips(CHIPS.noComplement);
        return;
      case "reference":
        t.say(COPY.askReference);
        t.chips(CHIPS.noReference);
        return;
      case "fulfillment":
        await this.fulfillmentPrompt(t);
        return;
      case "order_confirm":
        await this.showReview(t);
        return;
      case "symptom_consent":
        this.symptomConsentPrompt(t, true);
        return;
      case "symptom_answer":
        await this.askSymptomStep(t);
        return;
      case "rx_upload":
        t.say(COPY.rxNeeded, await this.rxUploadUi(t, null));
        return;
      case "attendant_question":
        t.say(COPY.attendantAsk);
        return;
      case "question_phone":
        this.askQuestionPhone(t, invalid);
        return;
      case "question_name":
        t.say(COPY.symptomAskName);
        t.chips(CHIP.skipName);
        return;
      case "product_request":
        t.say(ATT_COPY.askProduct);
        t.chips(ATT_CHIPS.talkPharmacist, ATT_CHIPS.hoursDelivery);
        return;
      case "product_request_consent":
        t.say(ATT_COPY.retryConfirm);
        t.chips(ATT_CHIPS.confirmRequest, CHIPS.onlyPharmacist);
        return;
      default:
        return;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Products and lanes B/C/D
  // -------------------------------------------------------------------------------------------

  private async handleResolution(t: Turn, resolution: Resolution, text: string) {
    const f = fold(text);
    const explicit = RE.purchaseVerb.test(f) || resolution.qty !== null || t.state.awaiting?.kind === "product_name";
    if (t.state.awaiting?.kind === "product_name") t.state.awaiting = null;

    if (resolution.status === "ambiguous") {
      if (resolution.qty !== null) t.state.pendingQty = resolution.qty;
      t.say(COPY.ambiguous);
      t.chips(...resolution.matches.map((m) => productLabel(m.product).slice(0, 60)).slice(0, 4));
      return;
    }
    const product = resolution.matches[0].product;
    const gate = gateForProduct(product);
    this.track(t, "pharmacy_product_requested", {
      productId: product.id,
      inStock: inStock(product) && (gate.kind === "otc" || gate.kind === "prescription"),
    });
    // "quero 2 dipirona" -> pick one of several: the quantity (and the intent to buy) carries over to the pick.
    const carried = t.state.pendingQty;
    const qty = resolution.qty ?? carried ?? 1;
    delete t.state.pendingQty;
    await this.presentProduct(t, product, qty, explicit || carried !== undefined);
  }

  private async presentProduct(t: Turn, product: ProductRow, qty: number, explicit: boolean) {
    const gate = gateForProduct(product);
    switch (gate.kind) {
      case "controlled":
      case "unclassified":
        this.controlledReply(t, product, gate.kind);
        return;
      case "pharmacist_required":
        t.state.lane = "otc";
        t.state.focus = { productId: product.id, kind: "pharmacist_required" };
        t.say(`${productLabel(product)}: ${COPY.pharmacistRequired}`);
        t.chips(CHIPS.alertPharmacist, CHIPS.makeOrder);
        return;
      case "inactive":
        t.say(COPY.notFound);
        t.chips(CHIPS.talkPharmacist);
        return;
      case "prescription":
        await this.rxFlow(t, product, qty);
        return;
      case "otc":
        break;
    }
    t.state.lane = "otc";
    if (!inStock(product)) {
      await this.outOfStock(t, product);
      return;
    }
    if (explicit) {
      await this.addToCart(t, product, qty, true);
      return;
    }
    t.state.focus = { productId: product.id, kind: "otc" };
    t.say("Encontrei:", productCardUi(product, t.settings, qty));
    t.chips(CHIPS.addToCart, CHIPS.talkPharmacist);
  }

  /** Lane D. Availability and price only; never a cart, in any phrasing. */
  private controlledReply(t: Turn, product: ProductRow, kind: "controlled" | "unclassified") {
    t.state.lane = "controlled";
    t.state.focus = { productId: product.id, kind };
    const available = inStock(product);
    const message = kind === "controlled" ? COPY.controlledInfo : COPY.unclassifiedInfo;
    const availability = available ? "Temos em estoque" : "Sem estoque no momento";
    t.say(`${productLabel(product)} · ${availability} · ${brl(product.priceCents)}. ${message}`, {
      type: "controlled_info",
      product: { name: product.name, presentation: product.presentation },
      available,
      priceCents: product.priceCents,
      message,
    });
    t.chips(CHIPS.talkPharmacist, CHIPS.makeOrder);
    this.track(t, "pharmacy_controlled_inquiry", { productId: product.id });
  }

  private async outOfStock(t: Turn, product: ProductRow) {
    t.state.focus = { productId: product.id, kind: "out_of_stock" };
    const label = productLabel(product);
    const unknown = product.stockQty === null || product.stockQty === undefined;
    const lead = unknown ? `${label}: não tenho o estoque confirmado agora.` : `${label} está sem estoque no momento.`;
    const equivalents = await this.catalogFor().equivalentsOf(t.business.id, product);
    if (equivalents.length === 0) {
      t.state.equivalentOffer = null;
      t.say(`${lead} Também não tenho um equivalente cadastrado pela farmácia. Posso avisar o farmacêutico para ver como ajudar.`);
      t.chips(CHIPS.alertPharmacist, CHIPS.makeOrder);
      return;
    }
    t.state.equivalentOffer = { forProductId: product.id, ids: equivalents.map((e) => e.id) };
    t.say(
      `${lead} A farmácia cadastrou ${equivalents.length === 1 ? "este equivalente" : "estes equivalentes"}. Se você escolher um, o farmacêutico confirma a troca com você antes de separar o pedido.`,
    );
    for (const e of equivalents) t.say(`${productLabel(e)} · ${brl(e.priceCents)}`, productCardUi(e, t.settings, 1));
    t.chips(...equivalents.map((e) => `Quero ${e.name}`.slice(0, 60)), CHIPS.alertPharmacist);
  }

  private async rxFlow(t: Turn, product: ProductRow, qty: number) {
    t.state.lane = "rx";
    t.state.focus = null;
    if (!inStock(product)) {
      await this.outOfStock(t, product);
      return;
    }
    const max = effectiveMaxQty(product, t.settings);
    if (qty > max) {
      t.say(`O máximo por pedido deste item é ${max}. Quer pedir ${max} ou falar com o farmacêutico sobre uma quantidade maior?`);
      t.chips(CHIPS.talkPharmacist);
      return;
    }
    const line: CartLine = { productId: product.id, qty };
    const uploads = await this.listRxUploads(t);
    if (uploads.length > 0) {
      this.mergeLine(t.state.cart, line);
      this.afterCartChange(t);
      t.say(`${COPY.rxReceived} Adicionei ao carrinho: ${qty}× ${productLabel(product)}.`, cartUi(await this.cartDto(t)));
      t.chips(CHIPS.checkout, CHIPS.addMore);
      return;
    }
    this.mergeLine(t.state.pendingRx, line);
    t.state.awaiting = { kind: "rx_upload" };
    t.say(`${productLabel(product)}: ${COPY.rxNeeded}`, await this.rxUploadUi(t, null));
    t.chips(CHIPS.talkPharmacist, CHIPS.uploadedRx);
  }

  private async rxUploadUi(t: Turn, orderRef: string | null): Promise<UiPayload> {
    // An earlier upload (or a remembered consent) means the notice was already accepted: the buttons just send the photo.
    let consented = this.hasConsent(t, "prescription_upload");
    if (!consented && (await this.listRxUploads(t)).length > 0) {
      this.grantConsent(t, "prescription_upload");
      consented = true;
    }
    return {
      type: "rx_upload",
      orderRef,
      accept: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      maxBytes: 8 * 1024 * 1024,
      consent: consented ? null : consentCard("prescription_upload"),
    };
  }

  private async listRxUploads(t: Turn): Promise<{ id: string }[]> {
    const rows = await this.db.prescriptionUpload.findMany({
      where: { businessId: t.business.id, conversationId: t.conversation.id, orderId: null },
    });
    return rows.filter((r: { status: string }) => r.status !== "rejected");
  }

  /** A prescription arrived (visitor upload endpoint): prescription lines move from "pending" into the cart. */
  private async syncPrescriptions(t: Turn) {
    if (t.mode.effective === "attendance" || t.state.pendingRx.length === 0 || this.inRedFlagCooldown(t)) return;
    const uploads = await this.listRxUploads(t);
    if (uploads.length === 0) return;
    for (const line of t.state.pendingRx) this.mergeLine(t.state.cart, line);
    t.state.pendingRx = [];
    if (t.state.awaiting?.kind === "rx_upload") t.state.awaiting = null;
    this.afterCartChange(t);
    t.say(COPY.rxReceived, cartUi(await this.cartDto(t)));
    t.chips(CHIPS.checkout, CHIPS.addMore);
  }

  private mergeLine(lines: CartLine[], line: CartLine) {
    const existing = lines.find((l) => l.productId === line.productId);
    if (existing) {
      existing.qty += line.qty;
      if (line.viaEquivalentOf) existing.viaEquivalentOf = line.viaEquivalentOf;
    } else lines.push({ ...line });
  }

  // -------------------------------------------------------------------------------------------
  // Cart
  // -------------------------------------------------------------------------------------------

  private async cartDto(t: Turn) {
    const products = await this.catalogFor().getMany(t.business.id, t.state.cart.map((l) => l.productId));
    return buildCartDto(t.state.cart, products, t.settings);
  }

  /** Any cart change invalidates a review in progress. */
  private afterCartChange(t: Turn) {
    if (t.state.checkoutStep && t.state.checkoutStep !== "done") {
      t.state.checkoutStep = null;
      t.state.awaiting = null;
    }
    if (t.state.cart.length === 0) t.state.equivalentOffer = t.state.equivalentOffer ?? null;
    t.dirty = true;
  }

  private async addToCart(t: Turn, product: ProductRow, qty: number, explicit: boolean) {
    if (this.inRedFlagCooldown(t)) {
      t.say(COPY.redFlagCooldown);
      t.chips(CHIPS.talkPharmacist);
      return;
    }
    const gate = gateForProduct(product);
    if (gate.kind === "controlled" || gate.kind === "unclassified") {
      this.controlledReply(t, product, gate.kind);
      return;
    }
    if (gate.kind === "pharmacist_required") {
      await this.presentProduct(t, product, qty, explicit);
      return;
    }
    if (gate.kind === "prescription") {
      await this.rxFlow(t, product, qty);
      return;
    }
    if (gate.kind === "inactive") {
      t.say(COPY.notFound);
      return;
    }
    if (!(qty >= 1)) qty = 1;
    if (!inStock(product)) {
      await this.outOfStock(t, product);
      return;
    }
    const existing = t.state.cart.find((l) => l.productId === product.id);
    const total = (existing?.qty ?? 0) + qty;
    const max = effectiveMaxQty(product, t.settings);
    if (total > max) {
      t.state.focus = { productId: product.id, kind: "otc" };
      const room = Math.max(0, max - (existing?.qty ?? 0));
      t.say(
        `O máximo por pedido deste item é ${max} ${max === 1 ? "unidade" : "unidades"}${existing ? ` (você já tem ${existing.qty} no carrinho)` : ""}. ${room > 0 ? `Posso adicionar ${room}, ou ` : "Se precisar de mais, "}o farmacêutico pode ajudar com uma quantidade maior.`,
      );
      t.chips(...(room > 0 ? [`Adicionar ${room}`] : []), CHIPS.talkPharmacist);
      return;
    }
    if (!inStock(product, total)) {
      t.say(`Tenho apenas ${product.stockQty} ${product.stockQty === 1 ? "unidade" : "unidades"} de ${productLabel(product)} em estoque.`);
      t.chips(CHIPS.viewCart, CHIPS.talkPharmacist);
      return;
    }
    if (!existing && t.state.cart.length >= MAX_CART_LINES) {
      t.say("Seu carrinho já tem muitos itens diferentes. Vamos finalizar este pedido primeiro?");
      t.chips(CHIPS.checkout);
      return;
    }
    const wasEmpty = t.state.cart.length === 0;
    const via = t.state.equivalentOffer?.ids.includes(product.id) ? t.state.equivalentOffer.forProductId : undefined;
    this.mergeLine(t.state.cart, { productId: product.id, qty, ...(via ? { viaEquivalentOf: via } : {}) });
    t.state.lastAddedId = product.id;
    t.state.focus = null;
    t.state.lane = "otc";
    this.afterCartChange(t);
    if (wasEmpty) this.track(t, "pharmacy_cart_created", { itemCount: qty });
    const note = via ? " O farmacêutico confirma essa troca com você antes de separar o pedido." : "";
    t.say(`Ótimo, adicionei ao carrinho: ${qty}× ${productLabel(product)} (${brl(product.priceCents * qty)}).${note}`, cartUi(await this.cartDto(t)));
    t.chips(CHIPS.checkout, CHIPS.addMore, CHIPS.viewCart);
  }

  private async setQty(t: Turn, productId: string, qty: number) {
    const line = t.state.cart.find((l) => l.productId === productId);
    if (!line) {
      await this.showCart(t);
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      t.state.cart = t.state.cart.filter((l) => l.productId !== productId);
      this.afterCartChange(t);
      await this.showCart(t);
      return;
    }
    const product = await this.catalogFor().getOne(t.business.id, productId);
    if (!product) {
      t.state.cart = t.state.cart.filter((l) => l.productId !== productId);
      this.afterCartChange(t);
      await this.showCart(t);
      return;
    }
    const max = effectiveMaxQty(product, t.settings);
    const wanted = Math.floor(qty);
    if (wanted > max || !inStock(product, wanted)) {
      line.qty = Math.min(line.qty, max, product.stockQty ?? 0) || line.qty;
      t.say(
        wanted > max
          ? `O máximo por pedido deste item é ${max}.`
          : `Tenho apenas ${product.stockQty ?? 0} em estoque.`,
        cartUi(await this.cartDto(t)),
      );
      t.chips(CHIPS.checkout, CHIPS.talkPharmacist);
      return;
    }
    line.qty = wanted;
    this.afterCartChange(t);
    await this.showCart(t);
  }

  private async removeByText(t: Turn, what: string): Promise<boolean> {
    const products = await this.catalogFor().getMany(t.business.id, t.state.cart.map((l) => l.productId));
    const tokens = productTokens(what);
    const target = products.find((p) => scoreProduct(p, tokens, what) >= 0.6);
    if (!target) return false;
    t.state.cart = t.state.cart.filter((l) => l.productId !== target.id);
    this.afterCartChange(t);
    await this.showCart(t);
    return true;
  }

  private async showCart(t: Turn) {
    const cart = await this.cartDto(t);
    if (cart.items.length === 0 && t.state.pendingRx.length === 0) {
      t.say(COPY.cartEmpty);
      t.chips(CHIPS.makeOrder, CHIPS.talkPharmacist);
      return;
    }
    const pending = t.state.pendingRx.length > 0 ? " Há um item de receita aguardando o envio da foto." : "";
    t.say(`Seu carrinho: ${cart.itemCount} ${cart.itemCount === 1 ? "item" : "itens"} · ${brl(cart.subtotalCents)}.${pending}`, cartUi(cart));
    t.chips(...(cart.items.length > 0 ? [CHIPS.checkout] : []), CHIPS.addMore, CHIPS.clearCart);
  }

  // -------------------------------------------------------------------------------------------
  // Checkout: cart -> customer step -> fulfillment -> address -> review -> order
  // -------------------------------------------------------------------------------------------

  /** Re-checks every cart line against the DB (class, stock, limit). Returns the names that had to go. */
  private async revalidateCart(t: Turn): Promise<string[]> {
    const products = await this.catalogFor().getMany(t.business.id, t.state.cart.map((l) => l.productId));
    const byId = new Map(products.map((p) => [p.id, p]));
    const removed: string[] = [];
    t.state.cart = t.state.cart.filter((line) => {
      const p = byId.get(line.productId);
      const gate = p ? gateForProduct(p).kind : "inactive";
      const ok = p && (gate === "otc" || gate === "prescription") && inStock(p, line.qty) && line.qty <= effectiveMaxQty(p, t.settings);
      if (!ok) removed.push(p ? productLabel(p) : "Item indisponível");
      return Boolean(ok);
    });
    if (removed.length > 0) t.dirty = true;
    return removed;
  }

  private async startCheckout(t: Turn) {
    if (this.inRedFlagCooldown(t)) {
      t.say(COPY.redFlagCooldown);
      t.chips(CHIPS.talkPharmacist);
      return;
    }
    if (t.state.checkoutStep === "done") {
      t.state.order = null;
      t.state.checkoutStep = null;
    }
    await this.syncPrescriptions(t);
    const removed = await this.revalidateCart(t);
    if (removed.length > 0) {
      t.say(`${COPY.orderChanged} (${removed.join(", ")})`);
      t.chips(CHIPS.viewCart, CHIPS.makeOrder);
      return;
    }
    if (t.state.cart.length === 0) {
      if (t.state.pendingRx.length > 0) {
        t.state.awaiting = { kind: "rx_upload" };
        t.say(COPY.rxNeeded, await this.rxUploadUi(t, null));
        t.chips(CHIPS.talkPharmacist, CHIPS.uploadedRx);
        return;
      }
      t.say(COPY.cartEmpty);
      t.chips(CHIPS.makeOrder, CHIPS.talkPharmacist);
      return;
    }
    // Prescription lines need an uploaded prescription (hard rule, re-checked here and at order time).
    const products = await this.catalogFor().getMany(t.business.id, t.state.cart.map((l) => l.productId));
    const rxLines = t.state.cart.filter((l) => products.find((p) => p.id === l.productId)?.saleClass === "prescription");
    if (rxLines.length > 0 && (await this.listRxUploads(t)).length === 0) {
      t.state.cart = t.state.cart.filter((l) => !rxLines.includes(l));
      for (const line of rxLines) this.mergeLine(t.state.pendingRx, line);
      t.state.awaiting = { kind: "rx_upload" };
      t.say(COPY.rxNeeded, await this.rxUploadUi(t, null));
      t.chips(CHIPS.talkPharmacist, CHIPS.uploadedRx);
      return;
    }
    await this.advanceContact(t);
  }

  private contactUi(t: Turn): UiPayload {
    const c = t.state.contact;
    const fields = [!c.phone && "phone", !c.leadId && !c.name && "name", !c.leadId && !c.email && !c.emailSkipped && "email"].filter(Boolean);
    // One tap: the card carries the notice and the form's button IS the consent. Not shown again once granted (or for a known lead).
    // Only on the full form (phone first): a card that asks for one missing field never repeats the notice; the
    // explicit consent step (askContactConsent) shows it once, at the end.
    const needsConsent = !c.leadId && !c.consent && !this.hasConsent(t, "order_contact") && fields.includes("phone");
    return {
      type: "contact_capture",
      fields,
      recognized: c.returningFirstName ? { firstName: c.returningFirstName, address: null } : null,
      consent: needsConsent ? consentCard("order_contact") : null,
    };
  }

  private askContactConsent(t: Turn) {
    t.state.awaiting = { kind: "contact_consent" };
    t.say(`${COPY.askContactConsent} ${consentCard("order_contact").text}`, { ...this.contactUi(t), fields: [], consent: consentCard("order_contact") });
    t.chips(CHIPS.consentAgree, CHIPS.cancel);
  }

  private async loadLead(t: Turn, leadId: string) {
    return this.db.lead.findFirst({ where: { id: leadId, businessId: t.business.id } });
  }

  private async advanceContact(t: Turn) {
    const c = t.state.contact;
    t.state.checkoutStep = "contact";
    if (!c.leadId && t.conversation.leadId) {
      const lead = await this.loadLead(t, t.conversation.leadId);
      if (lead) {
        c.leadId = lead.id;
        c.phone = lead.phone;
        c.name = lead.name ?? c.name;
        c.email = lead.email ?? c.email;
        c.returningFirstName = firstName(lead.name) ?? undefined;
      }
    }
    if (!c.phone) {
      t.state.awaiting = { kind: "phone" };
      t.say(`${COPY.askPhone} Seus dados são usados só para entregar e acompanhar o pedido (LGPD).`, this.contactUi(t));
      return;
    }
    if (!c.leadId) {
      if (!c.name) {
        t.state.awaiting = { kind: "name" };
        t.say(COPY.askName, this.contactUi(t));
        return;
      }
      if (!c.email && !c.emailSkipped) {
        t.state.awaiting = { kind: "email" };
        t.say(COPY.askEmail, this.contactUi(t));
        t.chips(CHIPS.skipEmail);
        return;
      }
      if (!c.consent && !this.hasConsent(t, "order_contact")) {
        this.askContactConsent(t);
        return;
      }
      c.consent = true;
      await this.createLead(t);
    } else if (!c.email && !c.emailSkipped) {
      t.state.awaiting = { kind: "email" };
      t.say(COPY.askEmail, this.contactUi(t));
      t.chips(CHIPS.skipEmail);
      return;
    } else if (c.email) {
      // Fill-only-if-empty (never overwrite what is on file).
      await this.db.lead.updateMany({ where: { id: c.leadId, businessId: t.business.id, email: null }, data: { email: c.email } }).catch(() => undefined);
    }
    t.state.awaiting = null;
    await this.askFulfillment(t);
  }

  private async setPhone(t: Turn, typed: string, canonical: string) {
    const c = t.state.contact;
    c.phone = canonical;
    const recognition = await this.customers.recognizeByPhone(t.business.id, typed);
    if (recognition.recognized) {
      const lead = await this.db.lead.findFirst({ where: { businessId: t.business.id, phoneNormalized: canonical } });
      if (lead) {
        c.leadId = lead.id;
        c.name = lead.name ?? c.name;
        c.email = lead.email ?? c.email;
        c.returningFirstName = recognition.firstName ?? undefined;
        await this.db.lead.update({ where: { id: lead.id }, data: { lastSeenAt: new Date(), sessionCount: { increment: 1 } } }).catch(() => undefined);
        await this.db.conversation.update({ where: { id: t.conversation.id }, data: { leadId: lead.id } }).catch(() => undefined);
        if (c.returningFirstName) t.prefix = `Oi, ${c.returningFirstName}! Que bom te ver de novo.`;
      }
    } else {
      c.leadId = undefined;
      c.returningFirstName = undefined;
    }
    await this.advanceContact(t);
  }

  private async createLead(t: Turn) {
    const c = t.state.contact;
    const phoneNormalized = c.phone!;
    let lead = await this.db.lead.findFirst({ where: { businessId: t.business.id, phoneNormalized } });
    if (!lead) {
      try {
        lead = await this.db.lead.create({
          data: { businessId: t.business.id, name: c.name ?? null, email: c.email ?? null, phone: phoneNormalized, phoneNormalized },
        });
      } catch (error) {
        if ((error as { code?: string }).code !== "P2002") throw error;
        lead = await this.db.lead.findFirst({ where: { businessId: t.business.id, phoneNormalized } });
      }
    }
    c.leadId = lead.id;
    await this.recordConsent(t, ["order_contact", "atendimento", "pedido"]);
    await this.db.conversation.update({ where: { id: t.conversation.id }, data: { leadId: lead.id } }).catch(() => undefined);
  }

  private async submitContact(t: Turn, input: { phone?: string; name?: string; email?: string; consent: boolean }) {
    if (t.state.awaiting?.kind === "symptom_phone" || t.state.awaiting?.kind === "symptom_name") {
      await this.symptomContact(t, { phone: input.phone, name: input.name });
      return;
    }
    if (t.state.awaiting?.kind === "question_phone" || t.state.awaiting?.kind === "question_name") {
      await this.questionContact(t, { phone: input.phone, name: input.name });
      return;
    }
    const c = t.state.contact;
    if (input.name?.trim() && !c.leadId) c.name = titleCaseName(input.name.slice(0, 80));
    if (input.email?.trim()) {
      if (isValidEmail(input.email)) c.email = input.email.trim().toLowerCase();
      else {
        t.say(COPY.badEmail, this.contactUi(t));
        return;
      }
    }
    // The widget form sends phone + name + consent in one go and labels the e-mail field "(opcional)":
    // a submitted name with an empty e-mail means "skip the e-mail", not "ask me again".
    else if (input.name?.trim() && !c.email) c.emailSkipped = true;
    // The e-mail card is optional: submitting it empty means "skip", never "ask me again".
    else if (t.state.awaiting?.kind === "email" && !c.email) c.emailSkipped = true;
    if (input.consent) c.consent = true;
    if (input.phone?.trim()) {
      const phone = canonicalPhone(input.phone);
      if (!phone || pickDigits(input.phone).length < 10) {
        t.state.awaiting = { kind: "phone" };
        t.state.checkoutStep = "contact";
        t.say(COPY.badPhone, this.contactUi(t));
        return;
      }
      await this.setPhone(t, input.phone.trim(), phone);
      return;
    }
    await this.advanceContact(t);
  }

  private fulfillmentOptions(t: Turn) {
    const options: { value: Fulfillment; label: string; feeCents: number }[] = [];
    if (t.settings.deliveryEnabled) options.push({ value: "delivery", label: "Entrega", feeCents: t.settings.deliveryFeeCents });
    if (t.settings.pickupEnabled) options.push({ value: "pickup", label: "Retirada em loja", feeCents: 0 });
    return options;
  }

  private async fulfillmentPrompt(t: Turn) {
    const options: Array<{ value: Fulfillment; label: string; feeCents: number; disabled?: boolean; disabledReason?: string }> = this.fulfillmentOptions(t);
    t.state.awaiting = { kind: "fulfillment" };
    // Below the delivery minimum the Entrega option is shown disabled, with the reason, instead of failing after the tap.
    const minCents = t.settings.minOrderCents;
    let deliveryDisabled = false;
    let missingCents = 0;
    if (t.settings.deliveryEnabled && minCents > 0) {
      const cart = await this.cartDto(t);
      if (cart.subtotalCents < minCents) {
        deliveryDisabled = true;
        missingCents = minCents - cart.subtotalCents;
        const reason = `pedido mínimo ${brl(minCents)}`;
        const d = options.find((o) => o.value === "delivery");
        if (d) {
          d.disabled = true;
          d.disabledReason = reason;
        }
      }
    }
    const fee = t.settings.deliveryEnabled && !deliveryDisabled ? ` Entrega: taxa de ${brl(t.settings.deliveryFeeCents)}.` : "";
    const ui: { type: string; [k: string]: unknown } = { type: "fulfillment_choice", options };
    if (t.settings.deliveryEnabled && minCents > 0) {
      ui.deliveryMinCents = minCents;
      if (deliveryDisabled) ui.deliveryDisabledReason = `pedido mínimo ${brl(minCents)}`;
    }
    const short = deliveryDisabled
      ? ` Para entregar em casa faltam só ${brl(missingCents)} para o pedido mínimo${t.settings.pickupEnabled ? "; se preferir, é só retirar na loja" : ""}.`
      : "";
    t.say(`${COPY.askFulfillment}${fee}${short}`, ui);
    t.chips(...options.filter((o) => !o.disabled).map((o) => (o.value === "delivery" ? CHIPS.delivery : CHIPS.pickup)), ...(deliveryDisabled ? [CHIPS.addMore] : []));
  }

  private async askFulfillment(t: Turn) {
    t.state.checkoutStep = "fulfillment";
    const options = this.fulfillmentOptions(t);
    if (options.length === 0) {
      t.state.awaiting = null;
      t.say("No momento a farmácia não está recebendo pedidos pelo chat. Posso chamar o farmacêutico para ajudar.");
      t.chips(CHIPS.talkPharmacist);
      return;
    }
    if (options.length === 1) {
      await this.chooseFulfillment(t, options[0].value);
      return;
    }
    await this.fulfillmentPrompt(t);
  }

  private async chooseFulfillment(t: Turn, fulfillment: Fulfillment) {
    if (fulfillment === "delivery" && !t.settings.deliveryEnabled) {
      t.say(COPY.deliveryUnavailable);
      t.state.awaiting = { kind: "fulfillment" };
      t.chips(CHIPS.pickup);
      return;
    }
    if (fulfillment === "pickup" && !t.settings.pickupEnabled) {
      t.say(COPY.pickupUnavailable);
      t.state.awaiting = { kind: "fulfillment" };
      t.chips(CHIPS.delivery);
      return;
    }
    if (!t.state.contact.leadId) {
      await this.advanceContact(t);
      return;
    }
    if (fulfillment === "delivery" && t.settings.minOrderCents > 0) {
      const cart = await this.cartDto(t);
      if (cart.subtotalCents < t.settings.minOrderCents) {
        t.state.fulfillment = undefined;
        t.state.awaiting = { kind: "fulfillment" };
        t.say(
          `Quase lá! O pedido mínimo para entrega é ${brl(t.settings.minOrderCents)} e o seu está em ${brl(cart.subtotalCents)} (faltam ${brl(t.settings.minOrderCents - cart.subtotalCents)}). Que tal incluir mais um item${t.settings.pickupEnabled ? " ou retirar na loja" : ""}?`,
        );
        t.chips(...(t.settings.pickupEnabled ? [CHIPS.pickup] : []), CHIPS.addMore);
        return;
      }
    }
    t.state.fulfillment = fulfillment;
    if (fulfillment === "pickup") {
      t.state.address = undefined;
      t.state.addressDiffersFromSaved = false;
      t.state.addressMasked = false;
      t.state.awaiting = null;
      await this.showReview(t);
      return;
    }
    await this.askAddress(t);
  }

  private async askAddress(t: Turn) {
    t.state.checkoutStep = "address";
    const c = t.state.contact;
    // An address already confirmed in this conversation is reused: the visitor is never asked twice.
    const known = t.state.knownAddress;
    if (known && !t.state.addressDraft?.replaceDefault) {
      t.state.address = known.address;
      t.state.addressMasked = known.masked;
      t.state.addressDiffersFromSaved = known.differsFromSaved;
      t.reusedAddress = true;
      await this.proceedAfterAddress(t);
      return;
    }
    if (c.leadId && !t.state.addressDraft?.replaceDefault) {
      const def = await this.customers.getDefaultAddress(t.business.id, c.leadId);
      if (def) {
        await this.askSavedAddress(t, def);
        return;
      }
    }
    await this.askCep(t);
  }

  private async askSavedAddress(t: Turn, preloaded?: any) {
    const c = t.state.contact;
    const def = preloaded ?? (c.leadId ? await this.customers.getDefaultAddress(t.business.id, c.leadId) : null);
    if (!def) {
      await this.askCep(t);
      return;
    }
    const masked = maskAddress(def);
    t.state.savedAddressId = def.id;
    t.state.awaiting = { kind: "saved_address" };
    t.say(`Confirma seu endereço de entrega? ${masked.label}.`, this.addressUi(masked, undefined, true));
    t.chips(CHIPS.savedOk, CHIPS.savedUpdate);
  }

  private addressUi(saved: ReturnType<typeof maskAddress> | null, fields: string[] = ["cep", "number", "complement", "reference"], askConfirmSaved = false): UiPayload {
    return { type: "address_capture", saved, askConfirmSaved, fields, numberHint: 'Use só números, 12B ou "sem número"' };
  }

  private async askCep(t: Turn) {
    t.state.checkoutStep = "address";
    t.state.awaiting = { kind: "cep" };
    t.state.addressDraft = { replaceDefault: t.state.addressDraft?.replaceDefault };
    t.say(COPY.askCep, this.addressUi(null));
    t.chips();
  }

  private async useSavedAddress(t: Turn, addressId?: string) {
    const c = t.state.contact;
    if (!c.leadId) {
      await this.advanceContact(t);
      return;
    }
    let def: any = null;
    if (addressId) {
      def = await this.db.customerAddress.findFirst({ where: { id: addressId, businessId: t.business.id, leadId: c.leadId, supersededAt: null } });
    }
    def = def ?? (await this.customers.getDefaultAddress(t.business.id, c.leadId));
    if (!def) {
      await this.askCep(t);
      return;
    }
    t.state.address = {
      cep: def.cep,
      street: def.street,
      number: def.number,
      complement: def.complement,
      reference: def.reference,
      district: def.district,
      city: def.city,
      state: def.state,
    };
    t.state.addressDiffersFromSaved = false;
    t.state.addressMasked = true; // the visitor only ever saw the masked version: keep it masked in the review
    await this.proceedAfterAddress(t);
  }

  private async lookupCepStep(t: Turn, cep8: string) {
    const outcome = await this.customers.lookupCep(cep8);
    const keepReplace = t.state.addressDraft?.replaceDefault;
    if (outcome.status === "not_found") {
      t.say(COPY.cepNotFound);
      return;
    }
    if (outcome.status === "invalid") {
      t.say(COPY.badCep);
      return;
    }
    if (outcome.status === "unavailable") {
      t.state.addressDraft = { cep: cep8, manual: true, replaceDefault: keepReplace };
      t.state.awaiting = { kind: "street_manual" };
      t.say(COPY.cepUnavailable);
      return;
    }
    const r = outcome.result;
    t.state.addressDraft = { cep: cep8, street: r.street, district: r.district, city: r.city, state: r.state, replaceDefault: keepReplace };
    if (!r.street) {
      t.state.addressDraft.needsStreet = true;
      t.state.awaiting = { kind: "street_manual" };
      t.say(`${r.district ? `${r.district}, ` : ""}${r.city}/${r.state}. ${COPY.askStreetOnly}`);
      return;
    }
    await this.askNumber(t);
  }

  private async askNumber(t: Turn) {
    const d = t.state.addressDraft ?? {};
    t.state.awaiting = { kind: "number" };
    const where = [d.street, d.district, d.city && d.state ? `${d.city}/${d.state}` : d.city].filter(Boolean).join(", ");
    t.say(`Encontrei: ${where}. ${COPY.askNumber}`, this.addressUi(null, ["number"]));
    t.chips("Sem número");
  }

  private async submitDraftAddress(t: Turn) {
    const d = t.state.addressDraft ?? {};
    await this.submitAddress(t, {
      cep: d.cep ?? "",
      number: d.number ?? "",
      complement: d.complement ?? null,
      reference: d.reference ?? null,
      street: d.street ?? null,
      district: d.district ?? null,
      city: d.city ?? null,
      state: d.state ?? null,
      replaceDefault: d.replaceDefault === true,
    });
  }

  private async submitAddress(
    t: Turn,
    input: { cep: string; number: string; complement?: string | null; reference?: string | null; street?: string | null; district?: string | null; city?: string | null; state?: string | null; replaceDefault?: boolean },
  ) {
    const c = t.state.contact;
    if (!c.leadId) {
      await this.advanceContact(t);
      return;
    }
    t.state.awaiting = null;
    try {
      const saved = await this.customers.saveAddress(t.business.id, c.leadId, input);
      t.state.address = saved.snapshot as AddressSnapshot;
      t.state.addressDiffersFromSaved = saved.differsFromSaved;
      t.state.addressMasked = false;
      t.state.addressDraft = undefined;
      await this.proceedAfterAddress(t);
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      const response = error.getResponse() as { code?: string; message?: string } | string;
      const code = typeof response === "object" ? response.code : undefined;
      const message = typeof response === "object" ? String(response.message ?? "") : String(response);
      const draft = { cep: input.cep, number: input.number, complement: input.complement, reference: input.reference, replaceDefault: input.replaceDefault };
      if (code === "CEP_UNAVAILABLE" || code === "ADDRESS_INCOMPLETE") {
        t.state.addressDraft = { ...draft, street: input.street ?? undefined, district: input.district ?? undefined, city: input.city ?? undefined, state: input.state ?? undefined, manual: true };
        t.state.awaiting = { kind: "street_manual" };
        t.say(code === "CEP_UNAVAILABLE" ? COPY.cepUnavailable : COPY.badManualAddress);
      } else if (/CEP não encontrado/i.test(message)) {
        t.state.addressDraft = { replaceDefault: input.replaceDefault };
        t.state.awaiting = { kind: "cep" };
        t.say(COPY.cepNotFound);
      } else if (/CEP inválido/i.test(message)) {
        t.state.awaiting = { kind: "cep" };
        t.say(COPY.badCep);
      } else if (/Número inválido/i.test(message)) {
        t.state.addressDraft = { ...t.state.addressDraft, ...draft, number: undefined };
        t.state.awaiting = { kind: "number" };
        t.say(message || COPY.askNumber);
        t.chips("Sem número");
      } else {
        t.say(COPY.genericError);
        t.chips(CHIPS.talkPharmacist);
      }
    }
  }

  private async proceedAfterAddress(t: Turn) {
    const address = t.state.address!;
    if (!isInsideDeliveryArea(t.settings.deliveryAreas, address)) {
      t.state.knownAddress = null;
      t.reusedAddress = false;
      t.state.address = undefined;
      t.state.addressMasked = false;
      t.state.fulfillment = undefined;
      t.state.awaiting = { kind: "fulfillment" };
      t.say(COPY.outsideArea);
      t.chips(...(t.settings.pickupEnabled ? [CHIPS.pickup] : []), CHIPS.otherAddress, CHIPS.talkPharmacist);
      return;
    }
    t.state.knownAddress = { address, masked: Boolean(t.state.addressMasked), differsFromSaved: Boolean(t.state.addressDiffersFromSaved) };
    await this.showReview(t);
  }

  private addressLabel(t: Turn): string | null {
    const a = t.state.address;
    if (!a) return null;
    if (t.state.addressMasked) return maskAddress({ ...a, id: "masked", isDefault: true }).label;
    return `${a.street}, ${a.number}${a.complement ? `, ${a.complement}` : ""} · ${a.district}`;
  }

  private async showReview(t: Turn) {
    const fulfillment = t.state.fulfillment;
    if (!fulfillment) {
      await this.askFulfillment(t);
      return;
    }
    if (fulfillment === "delivery" && !t.state.address) {
      await this.askAddress(t);
      return;
    }
    const products = await this.catalogFor().getMany(t.business.id, t.state.cart.map((l) => l.productId));
    const cart = buildCartDto(t.state.cart, products);
    if (cart.items.length === 0) {
      t.say(COPY.cartEmpty);
      t.state.checkoutStep = null;
      t.state.awaiting = null;
      return;
    }
    if (fulfillment === "delivery" && t.settings.minOrderCents > 0 && cart.subtotalCents < t.settings.minOrderCents) {
      t.state.fulfillment = undefined;
      await this.chooseFulfillment(t, "delivery");
      return;
    }
    const fee = fulfillment === "delivery" ? t.settings.deliveryFeeCents : 0;
    const total = cart.subtotalCents + fee;
    const involved = t.state.cart.map((l) => products.find((p) => p.id === l.productId)).filter((p): p is ProductRow => Boolean(p));
    const notices: string[] = [];
    if (isSheetStale(involved, t.settings.stockMaxAgeHours)) notices.push(COPY.staleStockNotice);
    if (cart.requiresPrescription) notices.push(COPY.rxReviewNotice);
    if (t.state.cart.some((l) => l.viaEquivalentOf)) notices.push("O farmacêutico confirma a troca do produto sem estoque antes de separar o pedido.");
    if (isOpenNow(t.settings.openingHours, t.business.timezone ?? "America/Sao_Paulo") === false) notices.push(COPY.closedNotice);
    const paymentLabel = paymentPhrase(t.settings.paymentMethods, fulfillment);
    // The review card carries the items, fee, total, address and payment: the text stays short (no duplicate summary).
    const reused = t.reusedAddress && fulfillment === "delivery";
    t.reusedAddress = false;
    // The notices live in the review card (once); the text only frames the step.
    const text = [`Quase pronto${nameComma(t.first)}! Confira seu pedido e confirme.`, ...(reused ? ["Usei o endereço que você já confirmou."] : [])].join("\n");
    t.state.checkoutStep = "review";
    t.state.awaiting = { kind: "order_confirm" };
    t.say(text, {
      type: "order_review",
      items: cart.items,
      subtotalCents: cart.subtotalCents,
      deliveryFeeCents: fee,
      totalCents: total,
      fulfillment,
      addressLabel: fulfillment === "delivery" ? this.addressLabel(t) : null,
      etaLabel: null,
      paymentLabel,
      staleStockNotice: notices.length > 0 ? notices.join(" ") : null,
    });
    t.chips(CHIPS.confirmOrder, ...(reused ? [CHIPS.otherAddress] : []), CHIPS.changeItems, CHIPS.cancel);
  }

  private statusUrl(token: string): string {
    const base = (process.env.NEXT_PUBLIC_CHAT_URL ?? "http://localhost:3005").replace(/\/$/, "");
    return `${base}/pedido/${token}`;
  }

  private async confirmOrder(t: Turn) {
    const s = t.state;
    if (s.order && s.checkoutStep === "done" && s.cart.length === 0) {
      // Idempotent: a double tap never creates a second order.
      t.say(`O pedido ${s.order.code} já foi registrado. Acompanhe pelo botão abaixo.`, {
        type: "order_confirmation",
        code: s.order.code,
        status: s.order.status,
        statusUrl: s.order.statusUrl,
        totalCents: s.order.totalCents,
        message: `Pedido ${s.order.code} registrado.`,
      });
      return;
    }
    if (this.inRedFlagCooldown(t)) {
      t.say(COPY.redFlagCooldown);
      t.chips(CHIPS.talkPharmacist);
      return;
    }
    if (s.cart.length === 0) {
      t.say(COPY.cartEmpty);
      t.chips(CHIPS.makeOrder);
      return;
    }
    if (!s.contact.leadId) {
      await this.advanceContact(t);
      return;
    }
    if (!s.fulfillment || (s.fulfillment === "delivery" && !s.address)) {
      await this.showReview(t);
      return;
    }
    if (s.checkoutStep !== "review") {
      await this.showReview(t);
      return;
    }
    const removed = await this.revalidateCart(t);
    if (removed.length > 0) {
      s.checkoutStep = null;
      s.awaiting = null;
      t.say(`${COPY.orderChanged} (${removed.join(", ")})`);
      t.chips(CHIPS.viewCart, CHIPS.makeOrder);
      return;
    }
    if (s.fulfillment === "delivery" && s.address && !isInsideDeliveryArea(t.settings.deliveryAreas, s.address)) {
      await this.proceedAfterAddress(t);
      return;
    }
    const products = await this.catalogFor().getMany(t.business.id, s.cart.map((l) => l.productId));
    const hasRxLine = s.cart.some((l) => products.find((p) => p.id === l.productId)?.saleClass === "prescription");
    const uploads = hasRxLine ? await this.listRxUploads(t) : [];
    if (hasRxLine && uploads.length === 0) {
      await this.startCheckout(t);
      return;
    }
    const swaps = s.cart.filter((l) => l.viaEquivalentOf);
    const fulfillmentUsed = s.fulfillment;
    let created;
    try {
      created = await this.orders.createFromCart({
        businessId: t.business.id,
        leadId: s.contact.leadId,
        conversationId: t.conversation.id,
        fulfillment: s.fulfillment,
        items: s.cart.map((l) => ({ productId: l.productId, qty: l.qty, ...(l.viaEquivalentOf ? { viaEquivalentOf: l.viaEquivalentOf } : {}) })),
        address: s.fulfillment === "delivery" ? s.address : undefined,
        prescriptionIds: uploads.map((u) => u.id),
        requirePharmacist: swaps.length > 0,
        addressDiffersFromSaved: s.addressDiffersFromSaved,
      });
    } catch (error) {
      if (error instanceof OrderRuleError) {
        this.logger.warn(`order blocked by rule ${error.code}`);
        s.checkoutStep = null;
        s.awaiting = null;
        t.say(`${COPY.orderChanged} Posso chamar o farmacêutico se precisar.`);
        t.chips(CHIPS.viewCart, CHIPS.talkPharmacist);
        return;
      }
      this.logger.error(`order creation failed: ${error instanceof Error ? error.message : String(error)}`);
      t.say(COPY.genericError);
      t.chips(CHIPS.confirmOrder, CHIPS.talkPharmacist);
      return;
    }
    const url = this.statusUrl(created.statusToken);
    s.order = { id: created.id, code: created.code, status: created.status, statusUrl: url, totalCents: created.totalCents };
    s.checkoutStep = "done";
    s.awaiting = null;
    s.cart = [];
    s.pendingRx = [];
    s.focus = null;
    s.address = undefined;
    s.fulfillment = undefined;
    s.addressMasked = false;
    s.equivalentOffer = null;
    this.track(t, "pharmacy_order_created", {
      orderId: created.id,
      fulfillment: fulfillmentUsed,
      totalCents: created.totalCents,
      autoConfirmed: created.autoConfirmed,
      hasPrescription: created.hasPrescription,
    });
    if (!this.orders.handlesNotifications) {
      await this.notifier.notify({ type: "new_order", businessId: t.business.id, orderCode: created.code, status: created.status });
    }
    if (swaps.length > 0) {
      const swapProducts = await this.catalogFor().getMany(t.business.id, swaps.map((l) => l.viaEquivalentOf!).concat(swaps.map((l) => l.productId)));
      const nameOf = (id: string) => (swapProducts.find((p) => p.id === id) ? productLabel(swapProducts.find((p) => p.id === id)!) : "");
      await this.createHandoff(t, {
        reason: "out_of_stock",
        urgent: false,
        summary: `Troca de produto sem estoque · ${created.code}`,
        brief: {
          requestedProduct: swaps.map((l) => nameOf(l.viaEquivalentOf!)).join(", "),
          stock: 0,
          equivalents: swaps.map((l) => ({ productId: l.productId, name: nameOf(l.productId) })),
          customerRequest: `Cliente escolheu um equivalente no pedido ${created.code}; confirmar a troca.`,
          conversationLink: this.conversationLink(t),
        },
      });
    }
    let message: string;
    if (created.autoConfirmed) {
      message = `Pedido ${created.code} confirmado${nameComma(t.first)}, obrigado pela confiança! Acompanhe pelo botão abaixo.`;
    } else if (created.hasPrescription) {
      message = `Pedido ${created.code} recebido${nameComma(t.first)}, obrigado! O farmacêutico vai validar a receita antes de confirmar. Acompanhe pelo botão abaixo.`;
    } else if (created.staleSheet) {
      message = `Pedido ${created.code} recebido. O estoque que tenho aqui pode estar desatualizado, então a farmácia vai confirmar a disponibilidade antes de confirmar o pedido. Acompanhe pelo botão abaixo.`;
    } else {
      message = `Pedido ${created.code} recebido${nameComma(t.first)}, obrigado! A farmácia confirma a disponibilidade em instantes. Acompanhe pelo botão abaixo.`;
    }
    t.say(message, { type: "order_confirmation", code: created.code, status: created.status, statusUrl: url, totalCents: created.totalCents, message });
    t.chips(CHIPS.makeOrder);
  }

  // -------------------------------------------------------------------------------------------
  // Attendance mode: AI attendant with escalation only. No catalog, stock, price, cart, order or prescription.
  // Red flag, symptom lane and general facts (lane F) are shared with commerce mode; the new part is the
  // product-request lane: free text -> consent -> PharmacistHandoff `product_request` (never a stock/price claim).
  // -------------------------------------------------------------------------------------------

  /** Mode is (or became) attendance: park old commerce state in the conversation (DB rows of orders/products stay untouched). */
  private resetCommerceState(t: Turn) {
    const s = t.state;
    const keep = new Set(["symptom_consent", "symptom_answer", "symptom_phone", "symptom_name", "product_request", "product_request_consent"]);
    const staleAwaiting = !!s.awaiting && !keep.has(s.awaiting.kind);
    if (s.cart.length === 0 && s.pendingRx.length === 0 && !s.checkoutStep && !s.focus && !s.equivalentOffer && !staleAwaiting) return;
    s.cart = [];
    s.pendingRx = [];
    s.checkoutStep = null;
    s.focus = null;
    s.equivalentOffer = null;
    if (staleAwaiting) s.awaiting = null;
    t.dirty = true;
  }

  private async routeAttendance(t: Turn, text: string, midStep: boolean): Promise<boolean> {
    const f = fold(text);

    if (f === fold(ATT_CHIPS.askProduct) || f === fold(CHIPS.makeOrder) || RE.startOrder.test(f)) {
      this.askProductRequest(t);
      return true;
    }
    if (RE.thanks.test(f) && f.split(" ").length <= 6) {
      t.say(`Por nada${nameComma(t.first)}! Foi um prazer ajudar. Se precisar de mais alguma coisa, estou por aqui.`);
      t.chips(ATT_CHIPS.askProduct, ATT_CHIPS.talkPharmacist);
      return true;
    }
    if (isGreeting(text)) {
      t.say(ATT_COPY.welcome(t.business.name));
      t.chips(ATT_CHIPS.talkPharmacist, ATT_CHIPS.hoursDelivery, ATT_CHIPS.askProduct);
      return true;
    }
    if (asksForDosage(text)) {
      t.say(COPY.dosageRefusal);
      t.chips(CHIPS.talkPharmacist, ATT_CHIPS.askProduct);
      return true;
    }
    if (!hasProductMention(text) && this.infoTopics(f).length > 0 && !asksRecommendation(text) && !detectsSymptomIntent(text)) {
      return this.answerInfo(t, this.infoTopics(f), text);
    }
    if (RE.orderStatus.test(f) && !midStep) {
      t.say(ATT_COPY.orderStatus);
      t.chips(CHIPS.talkPharmacist, CHIPS.hoursDelivery);
      return true;
    }
    if (RE.talkPharmacist.test(f)) {
      await this.requestPharmacist(t, text);
      return true;
    }
    if (!t.state.symptom?.active && detectsSymptomIntent(text)) {
      // A symptom message while a handoff is still open is extra information for that same handoff.
      if (t.state.handoffId && (await this.acknowledgeHandoffFollowUp(t, text))) return true;
      await this.startSymptomLane(t, text);
      return true;
    }
    if (!t.state.symptom?.active) {
      // "tem X?", "quanto custa X": Alex does not look anything up. The pharmacist confirms availability and price.
      if (asksAboutProduct(text) && hasProductMention(text)) {
        this.startProductRequest(t, text);
        return true;
      }
      if (await this.answerGeneralFromText(t, f, text)) return true;
      if (unknownStoreTopic(f) && (looksLikeQuestion(text) || f.split(" ").length >= 2) && !clinicalQuestion(text)) {
        if (await this.kbMayAnswer(t, text)) return false;
        await this.raiseGeneralQuestion(t, text);
        return true;
      }
      if (isBareProductIntent(text)) {
        this.askProductRequest(t);
        return true;
      }
    } else if (await this.answerGeneralFromText(t, f, text)) {
      return true;
    }
    if (this.inRedFlagCooldown(t) && (isAffirmative(text) || RE.purchaseVerb.test(f))) {
      t.say(COPY.redFlagCooldown);
      t.chips(CHIPS.talkPharmacist);
      return true;
    }
    if (t.state.handoffId && !t.state.symptom?.active) {
      if (await this.acknowledgeHandoffFollowUp(t, undefined, text)) return true;
    }
    return false;
  }

  private askProductRequest(t: Turn) {
    t.state.lane = "general";
    t.state.awaiting = { kind: "product_request" };
    t.say(ATT_COPY.askProduct);
    t.chips(ATT_CHIPS.talkPharmacist, ATT_CHIPS.hoursDelivery);
  }

  private startProductRequest(t: Turn, text: string) {
    t.state.lane = "general";
    t.state.pendingProductRequest = text.replace(/\s+/g, " ").trim().slice(0, 300);
    t.state.awaiting = { kind: "product_request_consent" };
    t.say(ATT_COPY.confirmRequest);
    t.chips(ATT_CHIPS.confirmRequest, "Agora não");
  }

  private consumeProductRequest(t: Turn, text: string): "done" | "invalid" | "skip" {
    const f = fold(text);
    if (isNegative(text)) {
      t.state.awaiting = null;
      t.say(ATT_COPY.declined);
      t.chips(ATT_CHIPS.talkPharmacist, ATT_CHIPS.hoursDelivery);
      return "done";
    }
    if (RE.talkPharmacist.test(f) || asksForDosage(text) || detectsSymptomIntent(text)) return "skip";
    if (hasProductMention(text) && !RE.hours.test(f) && !RE.deliveryInfo.test(f) && !RE.paymentInfo.test(f)) {
      this.startProductRequest(t, text);
      return "done";
    }
    return RE.hours.test(f) || RE.deliveryInfo.test(f) || RE.pickupInfo.test(f) || RE.paymentInfo.test(f) ? "skip" : "invalid";
  }

  private async consumeProductRequestConsent(t: Turn, text: string): Promise<"done" | "invalid" | "skip"> {
    const f = fold(text);
    if (isAffirmative(text) || f === fold(ATT_CHIPS.confirmRequest)) {
      const pending = t.state.pendingProductRequest ?? "";
      t.state.awaiting = null;
      t.state.pendingProductRequest = undefined;
      if (!pending) {
        this.askProductRequest(t);
        return "done";
      }
      await this.recordConsent(t, ["product_request"]);
      const requests = [...(t.state.productRequests ?? []), pending].slice(-5);
      t.state.productRequests = requests;
      this.track(t, "pharmacy_product_request", {});
      const handoff = await this.createHandoff(t, {
        reason: "product_request",
        urgent: false,
        summary: `Produto: ${pending}`.slice(0, 80),
        brief: buildProductRequestBrief(requests.join("; "), this.conversationLink(t)),
      });
      if (!handoff) {
        t.say(COPY.genericError);
        t.chips(CHIPS.talkPharmacist);
        return "done";
      }
      t.state.handoffId = handoff.id;
      t.say(ATT_COPY.done);
      t.chips(ATT_CHIPS.askProduct, CHIPS.hoursDelivery);
      return "done";
    }
    if (isNegative(text) || f === fold("Agora não")) {
      t.state.awaiting = null;
      t.state.pendingProductRequest = undefined;
      t.say(ATT_COPY.declined);
      t.chips(ATT_CHIPS.talkPharmacist, ATT_CHIPS.hoursDelivery);
      return "done";
    }
    return "invalid";
  }

  // -------------------------------------------------------------------------------------------
  // General questions (lane F): deterministic facts from PharmacySettings; the rest goes to the model
  // -------------------------------------------------------------------------------------------

  /** Topics of an information question; empty = not an information question. */
  private infoTopics(f: string): string[] {
    if (RE.fullInfo.test(f)) return ["hours", "delivery", "pickup", "payment", "exchange"];
    const topics: string[] = [];
    if (RE.hours.test(f) || RE.hoursDay.test(f)) topics.push("hours");
    if (RE.deliveryInfo.test(f)) topics.push("delivery");
    if (RE.pickupInfo.test(f)) topics.push("pickup");
    if (RE.paymentInfo.test(f)) topics.push("payment");
    if (RE.exchangeInfo.test(f)) topics.push("exchange");
    if (RE.minOrder.test(f) && !topics.includes("delivery")) topics.push("min");
    // "Horários e entrega": the combined chip answers the whole counter (hours, delivery, pickup, payment).
    if (topics.includes("hours") && topics.includes("delivery")) {
      for (const extra of ["pickup", "payment"]) if (!topics.includes(extra)) topics.push(extra);
    }
    return topics;
  }

  /** A direct answer to "vocês entregam em X?" from the configured districts; null when the areas cannot say (CEP prefixes, none). */
  private deliveryPlaceLine(t: Turn, place: string): string | null {
    const districts = t.settings.deliveryAreas.filter((a) => a.type === "district");
    if (districts.length === 0 || districts.length !== t.settings.deliveryAreas.length) return null;
    const hit = districts.find((a) => {
      const v = fold(a.value);
      return v === place || place.includes(v) || v.includes(place);
    });
    const label = titleCaseName(place);
    return hit
      ? `Entregamos sim em ${hit.value}${nameComma(t.first)}! Veja os detalhes:`
      : `${label} ainda não está na nossa lista de bairros de entrega${nameComma(t.first)}, mas você pode retirar na loja, ou me passar o CEP no pedido que eu confirmo. Veja o que atendemos:`;
  }

  /** Formatted answer blocks (markdown) from PharmacySettings only. */
  private infoBlocks(t: Turn, topics: string[], askedText = ""): string[] {
    const s = t.settings;
    const blocks: string[] = [];
    const order = ["hours", "delivery", "min", "pickup", "payment", "exchange"].filter((x) => topics.includes(x));
    for (const topic of order) {
      if (topic === "hours") {
        const all = (s.openingHours ?? []).filter((h) => h.label);
        // "e o domingo?": only the asked day when the hours name it, all of them otherwise.
        const day = hoursDayFilter(fold(askedText));
        const asked = day ? all.filter((h) => day.test(fold(h.label))) : [];
        const lines = (asked.length > 0 ? asked : all).map((h) => (h.open ? `- ${h.label}: ${h.from ?? "?"} às ${h.to ?? "?"}` : `- ${h.label}: fechado`));
        if (lines.length === 0) continue;
        const open = isOpenNow(s.openingHours, t.business.timezone ?? "America/Sao_Paulo");
        blocks.push(`**Horário de atendimento**\n${lines.join("\n")}${open === null ? "" : open ? "\nEstamos abertos agora." : "\nNo momento estamos fechados."}`);
      } else if (topic === "delivery") {
        if (!s.deliveryEnabled) {
          blocks.push("**Entrega**\n- A farmácia não faz entregas no momento.");
          continue;
        }
        const lines = [`- Entrega com taxa de ${brl(s.deliveryFeeCents)}`];
        if (s.minOrderCents > 0) lines.push(`- Pedido mínimo para entrega: ${brl(s.minOrderCents)}`);
        if (s.deliveryAreas.length > 0) lines.push(`- Atendemos: ${s.deliveryAreas.map((a) => (a.type === "cep_prefix" ? `CEP ${a.value}` : a.value)).join(", ")}`);
        blocks.push(`**Entrega**\n${lines.join("\n")}`);
      } else if (topic === "min") {
        if (s.minOrderCents > 0) blocks.push(`**Pedido mínimo**\n- Pedido mínimo para entrega: ${brl(s.minOrderCents)}`);
      } else if (topic === "pickup") {
        const line = t.mode.effective === "attendance" ? attendancePickupLine(s.pickupEnabled) : s.pickupEnabled ? "Você pode retirar o pedido na loja." : "A retirada em loja não está disponível no momento.";
        blocks.push(`**Retirada**\n- ${line}`);
      } else if (topic === "payment") {
        const line = t.mode.effective === "attendance" ? `${acceptedPaymentPhrase(s.paymentMethods)}.` : `${acceptedPaymentPhrase(s.paymentMethods)}. O pagamento é feito só na entrega ou na retirada.`;
        blocks.push(`**Pagamento**\n- ${line}`);
      } else if (topic === "exchange" && s.exchangePolicy) {
        blocks.push(`**Trocas e devoluções**\n- ${s.exchangePolicy}`);
      }
    }
    return blocks;
  }

  /** Lane F: deterministic answer from PharmacySettings; nothing configured for the topic -> the team confirms (general_question). */
  private async answerInfo(t: Turn, topics: string[], originalText: string): Promise<boolean> {
    t.state.lane = "general";
    const blocks = this.infoBlocks(t, topics, originalText);
    if (blocks.length === 0) {
      // Nothing configured for the topic: the knowledge base gets the question before the team does.
      if (await this.kbMayAnswer(t, originalText)) return false;
      await this.raiseGeneralQuestion(t, originalText);
      return true;
    }
    const place = topics.includes("delivery") && t.settings.deliveryEnabled ? askedDeliveryPlace(originalText) : null;
    const placeLine = place ? this.deliveryPlaceLine(t, place) : null;
    t.say(placeLine ? `${placeLine}\n\n${blocks.join("\n\n")}` : `${COPY.infoLead(t.first)}\n\n${blocks.join("\n\n")}`);
    t.chips(CHIPS.makeOrder, CHIPS.talkAttendant);
    return true;
  }

  /**
   * Knowledge base first: before a deterministic "unknown topic" shortcut escalates to the team, check whether the
   * pharmacy's own documents cover the question. When they do, the turn is left to the model path (RAG + grounding
   * guard); if that path abstains, ChatService still raises the team question.
   */
  private async kbMayAnswer(t: Turn, text: string): Promise<boolean> {
    try {
      const r = await retrieveChunksForChat(this.prisma, t.business.id, "farmacia", text, { text: expandAbbreviations(text) });
      return r.tenant.length > 0;
    } catch {
      return false;
    }
  }

  private async answerGeneralFromText(t: Turn, f: string, originalText: string): Promise<boolean> {
    const topics = this.infoTopics(f);
    if (topics.length === 0) return false;
    // Holidays are only answered when the owner wrote them into the opening hours ("Domingo e feriados").
    if (/\bferiados?\b/.test(f) && !(t.settings.openingHours ?? []).some((h) => /feriado/i.test(h.label ?? ""))) {
      if (await this.kbMayAnswer(t, originalText)) return false;
      await this.raiseGeneralQuestion(t, originalText);
      return true;
    }
    return this.answerInfo(t, topics, originalText);
  }

  // -------------------------------------------------------------------------------------------
  // Non-clinical questions Alex cannot answer: a `general_question` handoff for an ATTENDANT (never the pharmacist)
  // -------------------------------------------------------------------------------------------

  private startAttendantQuestion(t: Turn) {
    t.state.lane = "general";
    t.state.awaiting = { kind: "attendant_question" };
    t.say(COPY.attendantAsk);
    t.chips(CHIPS.talkPharmacist, CHIPS.hoursDelivery);
  }

  /**
   * The visitor asked something the settings/knowledge cannot answer. Clinical questions still go to the pharmacist.
   * The handoff summary is the question itself (non-health); the alert never contains it.
   */
  private async raiseGeneralQuestion(t: Turn, text: string) {
    if (clinicalQuestion(text) || detectsSymptomIntent(text) || asksForDosage(text)) {
      await this.requestPharmacist(t, text);
      return;
    }
    const question = text.replace(/\s+/g, " ").trim().slice(0, 300);
    t.state.lane = "general";
    const handoff = await this.createHandoff(t, {
      reason: "general_question",
      urgent: false,
      summary: question.slice(0, 160),
      brief: { question, customerRequest: question, conversationLink: this.conversationLink(t) },
    });
    const firstQuestion = !t.state.questionHandoffId;
    t.state.questionHandoffId = handoff?.id ?? null;
    t.say(firstQuestion ? COPY.generalQuestionAck : COPY.generalQuestionAckAgain(t.first));
    const c = t.state.contact;
    const known = Boolean(c.leadId || t.conversation.leadId || c.phone);
    // The WhatsApp offer is made once per conversation: a second question never re-asks for the number.
    if (handoff && !known && !t.state.questionContactDeclined && !t.state.questionPhoneAsked) {
      t.state.questionPhoneAsked = true;
      this.askQuestionPhone(t, false);
      return;
    }
    t.chips(CHIPS.makeOrder, CHIPS.hoursDelivery);
  }

  private askQuestionPhone(t: Turn, invalid: boolean) {
    t.state.awaiting = { kind: "question_phone" };
    t.say(invalid ? COPY.badPhone : COPY.generalQuestionAskPhone, {
      type: "contact_capture",
      purpose: "general_question",
      fields: ["phone", "name"],
      recognized: null,
      consent: this.hasConsent(t, "pharmacy_contact") ? null : consentCard("pharmacy_contact"),
    });
    t.chips(CHIP.chatOnly);
  }

  private declineQuestionContact(t: Turn) {
    t.state.questionContactDeclined = true;
    t.state.awaiting = null;
    t.say("Tudo bem, a resposta chega aqui mesmo no chat.");
    t.chips(CHIPS.makeOrder, CHIPS.hoursDelivery);
  }

  private async questionContact(t: Turn, input: { phone?: string; name?: string }) {
    const c = t.state.contact;
    if (t.state.awaiting?.kind === "question_phone") {
      const canonical = input.phone ? canonicalPhone(input.phone) : null;
      if (!canonical || !input.phone || pickDigits(input.phone).length < 10) {
        this.askQuestionPhone(t, !!input.phone);
        return;
      }
      c.phone = canonical;
      const lead = await this.db.lead.findFirst({ where: { businessId: t.business.id, phoneNormalized: canonical } });
      if (lead) {
        c.leadId = lead.id;
        c.name = lead.name ?? c.name;
        c.returningFirstName = firstName(lead.name) ?? undefined;
        await this.db.conversation.update({ where: { id: t.conversation.id }, data: { leadId: lead.id } }).catch(() => undefined);
        await this.recordConsent(t, ["pharmacy_contact", "contact"]);
        await this.attachQuestionContact(t);
        return;
      }
      const typedName = input.name?.replace(/\s+/g, " ").trim();
      if (typedName && typedName.length >= 2 && typedName.length <= 80 && !/[0-9@]/.test(typedName)) c.name = titleCaseName(typedName);
      if (!c.name) {
        t.state.awaiting = { kind: "question_name" };
        t.say(COPY.symptomAskName);
        t.chips(CHIP.skipName);
        return;
      }
    } else if (input.name?.trim()) {
      c.name = titleCaseName(input.name.replace(/\s+/g, " ").trim().slice(0, 80));
    }
    await this.createSymptomLead(t, ["pharmacy_contact", "contact"]);
    await this.attachQuestionContact(t);
  }

  /** The phone/name arrived after the handoff: link the lead to it so the team can answer (and reach the visitor). */
  private async attachQuestionContact(t: Turn) {
    t.state.awaiting = null;
    const handoffId = t.state.questionHandoffId;
    const leadId = t.state.contact.leadId;
    if (handoffId && leadId) {
      try {
        const row = await this.db.pharmacistHandoff.findFirst({ where: { id: handoffId, businessId: t.business.id } });
        if (row) {
          const brief = (row.brief && typeof row.brief === "object" ? row.brief : {}) as Record<string, unknown>;
          const contact = await this.symptomBriefContact(t);
          await this.db.pharmacistHandoff.update({ where: { id: row.id }, data: { leadId, brief: { ...brief, ...(contact ? { contact } : {}) } } });
        }
      } catch (error) {
        this.logger.warn(`question contact link failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    t.say("Anotei seu contato, obrigado! A equipe responde por aqui e também te avisa no WhatsApp.");
    t.chips(CHIPS.makeOrder, CHIPS.hoursDelivery);
  }

  /** Public: the model path abstained (or was down) on a question; the engine turns it into the team handoff. */
  async handleUnknownQuestion(businessId: string, conversationId: string, text: string): Promise<PharmacyTurnResult> {
    const turn = await this.loadTurn(businessId, conversationId);
    await this.raiseGeneralQuestion(turn, text);
    return this.finish(turn, 1);
  }

  /** The model abstained on something that is not a question ("o mais barato"): a warm "tell me more", never a cold dead end or a useless handoff. */
  async handleUnclearMessage(businessId: string, conversationId: string): Promise<PharmacyTurnResult> {
    const turn = await this.loadTurn(businessId, conversationId);
    turn.say(COPY.unclear(turn.first));
    turn.chips(CHIPS.makeOrder, CHIPS.talkPharmacist, CHIPS.hoursDelivery);
    return this.finish(turn, 1);
  }

  /** The text may be a question for the team (used by ChatService before a model abstention is shown). */
  isTeamQuestion(text: string): boolean {
    // Clinical questions the model could not ground go to the PHARMACIST (raiseGeneralQuestion routes them), never to a dead end.
    return looksLikeQuestion(text) || clinicalQuestion(text);
  }

  // -------------------------------------------------------------------------------------------
  // Quantity typed in the chat
  // -------------------------------------------------------------------------------------------

  private async tryQtyEdit(t: Turn, text: string): Promise<boolean> {
    if (t.mode.effective === "attendance") return false;
    const edit = parseQtyEdit(text);
    if (!edit) return false;
    // A product card waits for "Adicionar": "quero 2" then adds 2 of that product.
    const focus = t.state.focus?.kind === "otc" ? t.state.focus.productId : null;
    let productId: string | null = null;
    if ("target" in edit && edit.target) {
      if (t.state.cart.length === 0) return false;
      const products = await this.catalogFor().getMany(t.business.id, t.state.cart.map((l) => l.productId));
      const tokens = productTokens(edit.target);
      const hit = products.find((p) => scoreProduct(p, tokens, edit.target!) >= 0.6);
      if (!hit) return false;
      productId = hit.id;
    } else if (focus && (edit.op === "set" || edit.op === "add")) {
      const product = await this.catalogFor().getOne(t.business.id, focus);
      if (product) {
        await this.addToCart(t, product, edit.n, true);
        return true;
      }
    }
    productId = productId ?? t.state.lastAddedId ?? null;
    if (!productId || !t.state.cart.some((l) => l.productId === productId)) {
      // The last-added line is gone: with a single line in the cart there is no doubt about which one.
      if (t.state.cart.length === 1) productId = t.state.cart[0].productId;
      else if (t.state.cart.length === 0 && !("target" in edit && edit.target) && edit.op !== "set") {
        // "mais um" / "tira um" with nothing to change: say so warmly instead of sending it to the model.
        t.say(COPY.nothingToEdit(t.first));
        t.chips(CHIPS.makeOrder, CHIPS.talkPharmacist);
        return true;
      } else return false;
    }
    await this.applyQtyEdit(t, productId, edit);
    return true;
  }

  private async applyQtyEdit(t: Turn, productId: string, edit: NonNullable<ReturnType<typeof parseQtyEdit>>) {
    const line = t.state.cart.find((l) => l.productId === productId)!;
    const product = await this.catalogFor().getOne(t.business.id, productId);
    const label = product ? productLabel(product) : "item";
    const removeLine = async () => {
      t.state.cart = t.state.cart.filter((l) => l.productId !== productId);
      if (t.state.lastAddedId === productId) t.state.lastAddedId = null;
      this.afterCartChange(t);
      t.say(`Tirei ${label} do carrinho.`, cartUi(await this.cartDto(t)));
      t.chips(...(t.state.cart.length > 0 ? [CHIPS.checkout] : []), CHIPS.makeOrder);
    };
    if (edit.op === "remove") {
      await removeLine();
      return;
    }
    const wanted = edit.op === "set" ? edit.n : edit.op === "add" ? line.qty + edit.n : line.qty - edit.n;
    if (wanted <= 0) {
      await removeLine();
      return;
    }
    if (!product || !product.active) {
      t.say(COPY.notFound);
      return;
    }
    const gate = gateForProduct(product).kind;
    if (gate !== "otc" && gate !== "prescription") {
      t.state.cart = t.state.cart.filter((l) => l.productId !== productId);
      this.afterCartChange(t);
      this.controlledReply(t, product, gate === "controlled" ? "controlled" : "unclassified");
      return;
    }
    const max = effectiveMaxQty(product, t.settings);
    if (wanted > max) {
      t.say(`O máximo por pedido de ${label} é ${max} ${max === 1 ? "unidade" : "unidades"}. Mantive ${line.qty} no carrinho; se precisar de mais, o farmacêutico pode ajudar.`, cartUi(await this.cartDto(t)));
      t.chips(CHIPS.talkPharmacist, CHIPS.checkout);
      return;
    }
    if (!inStock(product, wanted)) {
      t.say(`Tenho apenas ${product.stockQty ?? 0} ${product.stockQty === 1 ? "unidade" : "unidades"} de ${label} em estoque. Mantive ${line.qty} no carrinho.`, cartUi(await this.cartDto(t)));
      t.chips(CHIPS.checkout, CHIPS.addMore, CHIPS.viewCart);
      return;
    }
    line.qty = wanted;
    t.state.lastAddedId = productId;
    this.afterCartChange(t);
    t.say(`Pronto: ${wanted}× ${label} (${brl(product.priceCents * wanted)}).`, cartUi(await this.cartDto(t)));
    t.chips(CHIPS.checkout, CHIPS.addMore, CHIPS.viewCart);
  }

  // -------------------------------------------------------------------------------------------
  // Pharmacist suggestion -> purchase
  // -------------------------------------------------------------------------------------------

  /** Newest pharmacist_suggestion message of the conversation (null when none or older than 14 days). */
  private async latestSuggestion(t: Turn): Promise<{ id: string; ui: Record<string, any>; ids: string[] } | null> {
    const rows: any[] = await this.db.message.findMany({
      where: { conversationId: t.conversation.id, role: "owner" },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    const row = rows.find((m) => isSuggestionMessage(m));
    if (!row) return null;
    const created = row.createdAt ? new Date(row.createdAt).getTime() : Date.now();
    if (Date.now() - created > SUGGESTION_MAX_AGE_MS) return null;
    const ui = (row.uiData ?? {}) as Record<string, any>;
    const items = Array.isArray(ui.items) ? ui.items : [];
    const ids = items.map((i: any) => (typeof i?.productId === "string" ? i.productId : null)).filter((id: string | null): id is string => Boolean(id));
    if (ids.length === 0) return null;
    return { id: row.id, ui, ids };
  }

  private async tryBuyFromSuggestion(t: Turn, f: string): Promise<boolean> {
    if (t.mode.effective === "attendance") return false;
    const choice = parseSuggestionChoice(f);
    const startOrder = f === fold(CHIPS.makeOrder) || RE.startOrder.test(f);
    if (!choice && !startOrder) return false;
    // A product card with "Adicionar" is on screen: the bare "quero" belongs to that card.
    if (t.state.focus?.kind === "otc" && /^(quero|quero esse|quero esse mesmo|adicionar|adiciona|pode adicionar)$/.test(f)) return false;
    const suggestion = await this.latestSuggestion(t);
    if (!suggestion) return false;
    if (!choice && t.state.suggestionHandledId === suggestion.id) return false; // already bought: "Fazer um pedido" is the catalog again
    await this.buyFromSuggestion(t, suggestion, choice ?? { kind: "all" });
    return true;
  }

  private async buyFromSuggestion(t: Turn, suggestion: { id: string; ui: Record<string, any>; ids: string[] }, choice: SuggestionChoice) {
    const ids = choice.kind === "index" ? suggestion.ids.slice(choice.index, choice.index + 1) : suggestion.ids;
    if (ids.length === 0) {
      t.say(COPY.suggestionIntro, await this.suggestionCard(t, suggestion));
      t.chips(CHIPS.otherProducts, CHIPS.talkPharmacist);
      return;
    }
    const result = await this.addManyToCart(t, ids.map((productId) => ({ productId, qty: 1 })));
    if (result.cooldown) return;
    const bought = result.added.length > 0 || result.rxPending.length > 0;
    if (bought) t.state.suggestionHandledId = suggestion.id;
    t.say(COPY.suggestionIntro, bought ? cartUi(await this.cartDto(t)) : await this.suggestionCard(t, suggestion));
    if (result.rxPending.length > 0) t.say(`${result.rxPending.map(productLabel).join(", ")}: ${COPY.rxNeeded}`, await this.rxUploadUi(t, null));
    if (result.blocked.length > 0) t.say(this.blockedLines(result.blocked));
    t.chips(...(t.state.cart.length > 0 ? [CHIPS.checkout] : []), CHIPS.otherProducts, CHIPS.talkPharmacist);
  }

  private async suggestionCard(t: Turn, suggestion: { ui: Record<string, any>; ids: string[] }): Promise<UiPayload> {
    const products = await this.catalogFor().getMany(t.business.id, suggestion.ids);
    return suggestionUi(suggestion.ui, products, suggestion.ids, t.settings);
  }

  private blockedLines(blocked: Array<{ product: ProductRow | null; reason: string }>): string {
    const why: Record<string, string> = {
      out_of_stock: "sem estoque no momento",
      not_online: "não é vendido online; venha à farmácia ou fale com o farmacêutico",
      needs_pharmacist: "precisa da confirmação do farmacêutico antes do pedido",
      unavailable: "indisponível",
      max_qty: "acima do máximo por pedido",
      cart_full: "o carrinho já tem muitos itens",
    };
    return `Não consegui adicionar: ${blocked.map((b) => `${b.product ? productLabel(b.product) : "item"} (${why[b.reason] ?? "indisponível"})`).join("; ")}.`;
  }

  /**
   * Adds several products with EXACTLY the single-add rules (class, stock, per-order limit read from the DB; the model
   * and the client never decide). Controlled/unclassified/unconfirmed can never enter a cart.
   */
  private async addManyToCart(t: Turn, entries: Array<{ productId: string; qty: number }>) {
    const out = {
      cooldown: false,
      added: [] as ProductRow[],
      rxPending: [] as ProductRow[],
      blocked: [] as Array<{ product: ProductRow | null; reason: string }>,
    };
    if (this.inRedFlagCooldown(t)) {
      t.say(COPY.redFlagCooldown);
      t.chips(CHIPS.talkPharmacist);
      out.cooldown = true;
      return out;
    }
    const products = await this.catalogFor().getMany(t.business.id, entries.map((e) => e.productId));
    const byId = new Map(products.map((p) => [p.id, p]));
    const uploads = await this.listRxUploads(t);
    const wasEmpty = t.state.cart.length === 0;
    for (const entry of entries) {
      const product = byId.get(entry.productId);
      if (!product) {
        out.blocked.push({ product: null, reason: "unavailable" });
        continue;
      }
      const qty = Math.max(1, Math.floor(Number(entry.qty)) || 1);
      const gate = gateForProduct(product).kind;
      if (gate === "controlled" || gate === "unclassified") {
        out.blocked.push({ product, reason: "not_online" });
        this.track(t, "pharmacy_controlled_inquiry", { productId: product.id });
        continue;
      }
      if (gate === "pharmacist_required") {
        out.blocked.push({ product, reason: "needs_pharmacist" });
        continue;
      }
      if (gate === "inactive") {
        out.blocked.push({ product, reason: "unavailable" });
        continue;
      }
      const lines = gate === "prescription" && uploads.length === 0 ? t.state.pendingRx : t.state.cart;
      const existing = lines.find((l) => l.productId === product.id);
      const total = (existing?.qty ?? 0) + qty;
      if (!inStock(product, total)) {
        out.blocked.push({ product, reason: "out_of_stock" });
        continue;
      }
      if (total > effectiveMaxQty(product, t.settings)) {
        out.blocked.push({ product, reason: "max_qty" });
        continue;
      }
      if (!existing && lines === t.state.cart && t.state.cart.length >= MAX_CART_LINES) {
        out.blocked.push({ product, reason: "cart_full" });
        continue;
      }
      this.mergeLine(lines, { productId: product.id, qty });
      if (lines === t.state.pendingRx) out.rxPending.push(product);
      else {
        out.added.push(product);
        t.state.lastAddedId = product.id;
      }
    }
    if (out.added.length > 0 || out.rxPending.length > 0) {
      t.state.focus = null;
      t.state.lane = out.added.length > 0 ? "otc" : "rx";
      this.afterCartChange(t);
      if (out.rxPending.length > 0) t.state.awaiting = { kind: "rx_upload" };
      if (wasEmpty && out.added.length > 0) this.track(t, "pharmacy_cart_created", { itemCount: out.added.length });
    }
    return out;
  }

  private async cartAddMany(t: Turn, action: PharmacyAction) {
    const raw = Array.isArray(action.items)
      ? (action.items as Array<{ productId?: unknown; qty?: unknown }>).map((i) => ({ productId: String(i?.productId ?? ""), qty: toQty(i?.qty) }))
      : Array.isArray(action.productIds)
        ? (action.productIds as unknown[]).map((id) => ({ productId: String(id ?? ""), qty: 1 }))
        : [];
    const seen = new Set<string>();
    const entries = raw.filter((e) => e.productId && !seen.has(e.productId) && seen.add(e.productId)).slice(0, MAX_CART_LINES);
    if (entries.length === 0) throw new BadRequestException("productIds é obrigatório");
    const result = await this.addManyToCart(t, entries);
    if (result.cooldown) return;
    if (result.added.length > 0 || result.rxPending.length > 0) {
      const names = result.added.map(productLabel).join(", ");
      t.say(result.added.length > 0 ? `Adicionei ao carrinho: ${names}.` : "Anotei o item que exige receita.", cartUi(await this.cartDto(t)));
    }
    if (result.rxPending.length > 0) t.say(`${result.rxPending.map(productLabel).join(", ")}: ${COPY.rxNeeded}`, await this.rxUploadUi(t, null));
    if (result.blocked.length > 0) t.say(this.blockedLines(result.blocked));
    t.chips(...(t.state.cart.length > 0 ? [CHIPS.checkout] : []), CHIPS.addMore, CHIPS.talkPharmacist);
  }

  /** History rendering: pharmacist_suggestion cards get LIVE price/stock/class (the stored payload is only the pharmacist's pick). */
  async hydrateMessages(businessId: string, rows: any[]): Promise<any[]> {
    const suggestionRows = rows.filter((r) => isSuggestionMessage(r));
    if (suggestionRows.length === 0) return rows;
    const settings = await this.catalogFor().settings(businessId);
    const ids = [...new Set(suggestionRows.flatMap((r) => (Array.isArray(r.uiData?.items) ? r.uiData.items.map((i: any) => i?.productId) : [])).filter((id: unknown): id is string => typeof id === "string"))];
    const products = ids.length > 0 ? await this.catalogFor().getMany(businessId, ids) : [];
    return rows.map((r) => {
      if (!isSuggestionMessage(r)) return r;
      const orderedIds = (Array.isArray(r.uiData?.items) ? r.uiData.items : []).map((i: any) => i?.productId).filter((id: unknown): id is string => typeof id === "string");
      return { ...r, uiData: suggestionUi(r.uiData ?? {}, products, orderedIds, settings) };
    });
  }

  private async answerOrderStatus(t: Turn) {
    const bid = t.business.id;
    let order = await this.db.order.findFirst({ where: { businessId: bid, conversationId: t.conversation.id }, orderBy: { createdAt: "desc" } });
    const leadId = t.state.contact.leadId ?? t.conversation.leadId;
    if (!order && leadId) order = await this.db.order.findFirst({ where: { businessId: bid, leadId }, orderBy: { createdAt: "desc" } });
    if (!order) {
      t.say(COPY.noOrderYet);
      t.chips(CHIPS.makeOrder);
      return;
    }
    const label: Record<string, string> = {
      pending_pharmacist: "recebido, aguardando a confirmação da farmácia",
      confirmed: "confirmado",
      out_for_delivery: "saiu para entrega",
      ready_for_pickup: "pronto para retirada",
      delivered: "entregue",
      canceled: "cancelado",
      rejected: "recusado",
    };
    t.say(`Seu pedido ${order.code} está ${label[order.status] ?? order.status}. Acompanhe: ${this.statusUrl(order.statusToken)}`);
    t.chips(CHIPS.makeOrder, CHIPS.talkPharmacist);
  }
}

// ---------------------------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------------------------

export function normalizeState(raw: unknown): PharmacyState {
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<PharmacyState>;
  return {
    ...base,
    ...r,
    v: 1,
    cart: Array.isArray(r.cart) ? r.cart : [],
    pendingRx: Array.isArray(r.pendingRx) ? r.pendingRx : [],
    contact: r.contact && typeof r.contact === "object" ? r.contact : {},
    humanJoined: Array.isArray(r.humanJoined) ? r.humanJoined : [],
  };
}

/** Message row -> API shape: `ui` (from uiData) and `author` (people only), additive. */
export function serializePharmacyMessage(row: any) {
  return {
    ...row,
    ui: row.uiData ?? null,
    author: row.authorMemberId ? { memberId: row.authorMemberId, name: row.authorName ?? "", roleName: row.authorRole ?? "" } : null,
  };
}

function toQty(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** "Rua das Flores, Água Verde, Curitiba/PR" (or just the street when the CEP gave the rest). */
export function parseManualAddress(
  text: string,
  draft: { street?: string; district?: string; city?: string; state?: string; needsStreet?: boolean },
): { street: string; district: string; city: string; state: string } | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < 3 || clean.length > 160) return null;
  if (draft.needsStreet && draft.city && draft.state) {
    return { street: clean, district: draft.district ?? "", city: draft.city, state: draft.state };
  }
  const parts = clean.split(/\s*,\s*/).filter(Boolean);
  if (parts.length < 3) return null;
  const street = parts[0];
  const district = parts[1];
  const last = parts.slice(2).join(" ");
  const cityState = last.match(/^(.+?)\s*[\/\-]\s*([A-Za-z]{2})$/);
  if (cityState) return { street, district, city: cityState[1].trim(), state: cityState[2].toUpperCase() };
  if (parts.length >= 4 && /^[A-Za-z]{2}$/.test(parts[3])) return { street, district, city: parts[2], state: parts[3].toUpperCase() };
  return null;
}
