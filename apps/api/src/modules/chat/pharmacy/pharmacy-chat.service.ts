// Pharmacy chat engine. CODE decides safety and money; the model never does:
//   red flag -> lane router (OTC cart / prescription / controlled / symptom handoff / general)
//   -> deterministic cart + checkout state machine persisted in Conversation.pharmacyState.
// Everything here works with the model completely unavailable. See docs/pharmacy/CHAT_ENGINE_REPORT.md.

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
import { getPersona } from "../personas";
import { isGreeting } from "../safe-replies";
import { PharmacyCatalog, productLabel, scoreProduct, type Resolution } from "./catalog";
import { CHIPS, COPY, CONSENT_VERSION, consentCard, paymentPhrase } from "./copy";
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
  asksRecommendation,
} from "./symptom";
import { brl, fold, isAffirmative, isNegative, isValidEmail, pickDigits, productTokens, titleCaseName } from "./text";
import {
  PHARMACY_HANDOFFS_PORT,
  PHARMACY_NOTIFIER_PORT,
  PHARMACY_ORDERS_PORT,
  emptyState,
  type AddressSnapshot,
  type Awaiting,
  type CartLine,
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
import { buildCartDto, cartUi, productCardUi } from "./ui";

const RED_FLAG_COOLDOWN_MS = 30 * 60_000;
const MAX_CART_LINES = 15;

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
  ) {}
  /** Text glued in front of the next message (e.g. the greeting for a recognized customer). */
  prefix = "";
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

const RE = {
  cancel: /^(cancelar|cancela|cancelar pedido|cancelar tudo|desistir|desisti|deixa pra la|esquece|nao quero mais|esquece isso)$/,
  talkPharmacist: /\b(farmaceutic[oa]s?|atendente|humano|pessoa de verdade|alguem de verdade|falar com alguem|falar com uma pessoa|falar com a farmacia|responsavel tecnic[oa])\b/,
  viewCart: /\b(ver|mostrar|mostra|abrir|abre|qual|como esta|conferir)\b.{0,14}\bcarrinho\b|^carrinho$|^meu carrinho$/,
  clearCart: /\b(esvaziar|limpar|zerar)\b.{0,12}\bcarrinho\b/,
  checkout: /\b(finalizar|fechar|concluir|encerrar|prosseguir)\b.{0,20}\b(pedido|compra|carrinho)\b|^(finalizar|fechar pedido|continuar|prosseguir|pagar|fechar)$|\bquero finalizar\b|\bquero fechar\b/,
  removeItem: /^(remover|tirar|retirar|excluir|remove)\s+(.+)/,
  changeItems: /^(alterar itens|mudar itens|editar carrinho|mudar pedido)$/,
  startOrder: /\b(fazer|montar|iniciar|comecar|novo)\b.{0,12}\bpedido\b|^(quero )?pedir$/,
  thanks: /^(muito )?(obrigad[oa]|brigad[oa]|valeu|vlw|tchau|ate mais|ate logo|ok obrigad[oa]|certo obrigad[oa])\b/,
  orderStatus: /\b(status|acompanhar|acompanhamento|rastrear|onde esta|cade|como esta|andamento|ja saiu|chegou)\b.{0,25}\b(pedido|entrega|encomenda|compra)\b|\bmeu pedido\b/,
  purchaseVerb: /\b(quero|queria|preciso|precisava|gostaria|pedir|pedido de|comprar|adicionar|adiciona|coloca|colocar|poe|por no carrinho|me ve|me manda|manda|vou querer|levar|leva)\b/,
  hours: /\b(horario|horarios|funciona|funcionamento|abre|aberto|aberta|fecha|fechado|fechada|abertos|ate que horas|que horas)\b/,
  deliveryInfo: /\b(entrega|entregam|entregas|frete|taxa|delivery|motoboy|tempo de entrega|area de entrega|entregam em|atendem em|bairros?)\b/,
  pickupInfo: /\b(retirada|retirar|buscar na loja|buscar ai|pegar na loja|retiro)\b/,
  paymentInfo: /\b(pagamento|pagar|pix|cartao|dinheiro|forma de pagamento|formas de pagamento)\b/,
  exchangeInfo: /\b(troca|trocar|devolucao|devolver|reembolso|arrependimento)\b/,
  minOrder: /\b(pedido minimo|valor minimo|minimo de pedido|compra minima)\b/,
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
    await this.onAction(turn, action);
    const result = await this.finish(turn, 0);
    return { messages: result.messages, pharmacy: result.pharmacy, suggestions: result.suggestions };
  }

  async getView(businessId: string, conversationId: string): Promise<PharmacyView> {
    const conversation = await this.db.conversation.findFirst({ where: { id: conversationId, businessId } });
    const state = normalizeState(conversation?.pharmacyState);
    return this.buildView(businessId, conversationId, state);
  }

  /** Fixed LGPD wording per purpose (GET /chat/:businessId/consent-text). */
  consentText(purpose: string) {
    if (purpose !== "pharmacy_triage" && purpose !== "prescription_upload" && purpose !== "order_contact") {
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
    return new Turn(normalizeState(conversation.pharmacyState), business, conversation, settings);
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
    const pharmacy = await this.buildView(turn.business.id, turn.conversation.id, turn.state);
    return { message: rows[0] ?? null, messages: rows, suggestions: turn.suggestions, pharmacy, escalated: false };
  }

  async buildView(businessId: string, conversationId: string, state: PharmacyState): Promise<PharmacyView> {
    const catalog = this.catalogFor();
    const products = await catalog.getMany(businessId, state.cart.map((l) => l.productId));
    const joined = await this.db.message.findMany({ where: { conversationId, kind: "human_joined" }, orderBy: { createdAt: "asc" } });
    const seen = new Set<string>();
    const humanJoined = [];
    for (const m of joined) {
      if (!m.authorMemberId || seen.has(m.authorMemberId)) continue;
      seen.add(m.authorMemberId);
      humanJoined.push({ memberId: m.authorMemberId, name: m.authorName ?? "", roleName: m.authorRole ?? "" });
    }
    return {
      lane: state.lane,
      cart: buildCartDto(state.cart, products),
      checkoutStep: state.checkoutStep,
      orderCode: state.order?.code ?? null,
      statusUrl: state.order?.statusUrl ?? null,
      humanJoined,
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

    // 3. Consume what the current step is waiting for.
    const consumed = await this.consumeAwaiting(t, text);
    if (consumed === "done") return true;

    // 4. Intents.
    if (await this.routeIntent(t, text, consumed === "invalid")) return true;

    if (consumed === "invalid") {
      await this.promptAwaiting(t, true);
      return true;
    }
    return false;
  }

  private async routeIntent(t: Turn, text: string, midStep: boolean): Promise<boolean> {
    const f = fold(text);

    if (f === fold(CHIPS.makeOrder) || RE.startOrder.test(f)) {
      t.say(COPY.askProduct);
      t.chips(CHIPS.talkPharmacist, CHIPS.hoursDelivery);
      t.state.awaiting = { kind: "product_name" };
      return true;
    }
    if (f === fold(CHIPS.hoursDelivery)) {
      this.answerGeneral(t, "hours+delivery");
      return true;
    }
    if (RE.thanks.test(f) && f.split(" ").length <= 6) {
      t.say("Por nada! Se precisar de algo, é só chamar.");
      t.chips(CHIPS.makeOrder, CHIPS.talkPharmacist);
      return true;
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
      if ((RE.purchaseVerb.test(f) || t.state.awaiting?.kind === "product_name") && !wantsRecommendation && this.looksLikeProductRequest(f)) {
        if (t.state.awaiting?.kind === "product_name") t.state.awaiting = null;
        t.say(COPY.notFound);
        t.chips(CHIPS.talkPharmacist, CHIPS.makeOrder);
        return true;
      }
    }

    // A pharmacy question that is not a product: deterministic facts first.
    if (this.answerGeneralFromText(t, f)) return true;

    // Right after a red flag: any purchase-like continuation gets the urgent reminder, never a sale.
    if (this.inRedFlagCooldown(t) && (isAffirmative(text) || RE.purchaseVerb.test(f) || f === fold(CHIPS.confirmOrder))) {
      t.say(COPY.redFlagCooldown);
      t.chips(CHIPS.talkPharmacist);
      return true;
    }

    // Follow-up on an open handoff: acknowledge instead of sending it to the model.
    if (t.state.handoffId && !t.state.symptom?.active) {
      if (await this.acknowledgeHandoffFollowUp(t)) return true;
    }
    return false;
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
    switch (type) {
      case "cart.add": {
        const product = await this.requireProduct(t, String(action.productId ?? ""));
        await this.addToCart(t, product, toQty(action.qty), true);
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
          t.say("Ainda não recebi a foto da receita. Assim que você enviar, eu sigo com o pedido.", this.rxUploadUi(null));
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
    input: { reason: "symptom" | "rx" | "controlled" | "out_of_stock" | "other"; urgent: boolean; summary: string; brief: Record<string, unknown> },
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
      t.say("Pronto, o farmacêutico já foi avisado e responde por aqui assim que puder. Enquanto isso, se piorar ou for urgente, ligue 192 (SAMU).");
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

  private async requestPharmacist(t: Turn, text: string) {
    if (t.state.focus && t.state.focus.kind !== "otc") {
      await this.handoffForFocus(t);
      return;
    }
    await this.startSymptomLane(t, text);
  }

  private async acknowledgeHandoffFollowUp(t: Turn, followUpText?: string): Promise<boolean> {
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
    t.say(humanPresent ? "Anotado. O farmacêutico vê sua mensagem e responde por aqui." : COPY.handoffAdded);
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Symptom lane (E): one question per turn, then a handoff. NEVER a product or dose in customer text.
  // -------------------------------------------------------------------------------------------

  private async startSymptomLane(t: Turn, text: string) {
    t.state.lane = "symptom";
    t.state.focus = null;
    const isSymptomText = detectsSymptomIntent(text);
    t.state.symptom = {
      active: false,
      consent: false,
      step: "symptom",
      answers: {},
      pendingText: isSymptomText ? text.slice(0, 300) : undefined,
      startedAt: new Date().toISOString(),
    };
    t.state.awaiting = { kind: "symptom_consent" };
    this.track(t, "pharmacy_symptom_started", {});
    this.symptomConsentPrompt(t, false);
  }

  private symptomConsentPrompt(t: Turn, retry: boolean) {
    const text = retry ? COPY.symptomConsentRetry : `${COPY.symptomIntro} ${COPY.symptomConsentAsk}`;
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

  private async grantSymptomConsent(t: Turn, askNext = true) {
    const s = t.state.symptom!;
    s.consent = true;
    s.active = true;
    await this.recordConsent(t, ["pharmacy_triage"]);
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
    if (!s.consent) {
      if (!consent) {
        this.symptomConsentPrompt(t, true);
        return;
      }
      await this.grantSymptomConsent(t, !value);
      if (!value) return;
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
    const catalog = this.catalogFor();
    let suggestions: ReturnType<typeof filterSuggestions> = [];
    try {
      const candidates = await catalog.searchOtcInStock(t.business.id, suggestionKeywords(s.answers.symptom ?? ""));
      suggestions = filterSuggestions(candidates, s.answers);
    } catch (error) {
      this.logger.warn(`pharmacist suggestions skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
    const brief = buildSymptomBrief(s.answers, suggestions, { conversationId: t.conversation.id });
    const handoff = await this.createHandoff(t, { reason: "symptom", urgent: false, summary: summaryLine(s.answers), brief });
    t.state.handoffId = handoff?.id ?? t.state.handoffId ?? null;
    s.active = false;
    t.state.awaiting = null;
    t.state.lane = "symptom";
    const terms = await catalog.forbiddenTerms(t.business.id).catch(() => [] as string[]);
    const safe = guardSymptomLaneText(COPY.handoffDone, terms);
    t.say(safe.text);
    t.chips(CHIPS.makeOrder, CHIPS.hoursDelivery);
  }

  private async cancelFlow(t: Turn): Promise<boolean> {
    if (t.state.symptom?.active || t.state.awaiting?.kind === "symptom_consent") {
      if (t.state.symptom) t.state.symptom.active = false;
      t.state.awaiting = null;
      t.say("Tudo bem, parei por aqui. Se precisar do farmacêutico, é só chamar.");
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
    t.say("Tudo bem! Se precisar de algo, é só falar.");
    t.chips(CHIPS.makeOrder, CHIPS.talkPharmacist);
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Consent + lead helpers
  // -------------------------------------------------------------------------------------------

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

      case "rx_upload": {
        if (f === fold(CHIPS.uploadedRx) || /\b(enviei|mandei|anexei|subi)\b.{0,20}\breceita\b/.test(f)) {
          t.say("Ainda não recebi a foto da receita. Toque em \"Tirar foto\" ou \"Escolher arquivo\" para enviar.", this.rxUploadUi(null));
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
          t.state.awaiting = null;
          t.say("Sem esses dados não consigo finalizar o pedido por aqui. Se preferir, posso chamar o farmacêutico.");
          t.chips(CHIPS.talkPharmacist, CHIPS.viewCart);
          return "done";
        }
        return "invalid";
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
        return "invalid";
      }
    }
  }

  private async promptAwaiting(t: Turn, invalid: boolean) {
    const aw: Awaiting | null = t.state.awaiting;
    if (!aw) return;
    switch (aw.kind) {
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
        this.fulfillmentPrompt(t);
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
        t.say(COPY.rxNeeded, this.rxUploadUi(null));
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
    await this.presentProduct(t, product, resolution.qty ?? 1, explicit);
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
    t.say("Encontrei:", productCardUi(product, t.settings, 1));
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
    t.say(`${productLabel(product)}: ${COPY.rxNeeded}`, this.rxUploadUi(null));
    t.chips(CHIPS.talkPharmacist, CHIPS.uploadedRx);
  }

  private rxUploadUi(orderRef: string | null): UiPayload {
    return {
      type: "rx_upload",
      orderRef,
      accept: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      maxBytes: 8 * 1024 * 1024,
      consent: consentCard("prescription_upload"),
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
    if (t.state.pendingRx.length === 0 || this.inRedFlagCooldown(t)) return;
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
    return buildCartDto(t.state.cart, products);
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
    t.state.focus = null;
    t.state.lane = "otc";
    this.afterCartChange(t);
    if (wasEmpty) this.track(t, "pharmacy_cart_created", { itemCount: qty });
    const note = via ? " O farmacêutico confirma essa troca com você antes de separar o pedido." : "";
    t.say(`Adicionei ao carrinho: ${qty}× ${productLabel(product)} (${brl(product.priceCents * qty)}).${note}`, cartUi(await this.cartDto(t)));
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
        t.say(COPY.rxNeeded, this.rxUploadUi(null));
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
      t.say(COPY.rxNeeded, this.rxUploadUi(null));
      t.chips(CHIPS.talkPharmacist, CHIPS.uploadedRx);
      return;
    }
    await this.advanceContact(t);
  }

  private contactUi(t: Turn): UiPayload {
    const c = t.state.contact;
    const fields = [!c.phone && "phone", !c.leadId && !c.name && "name", !c.leadId && !c.email && !c.emailSkipped && "email"].filter(Boolean);
    return {
      type: "contact_capture",
      fields,
      recognized: c.returningFirstName ? { firstName: c.returningFirstName, address: null } : null,
      consent: consentCard("order_contact"),
    };
  }

  private askContactConsent(t: Turn) {
    t.state.awaiting = { kind: "contact_consent" };
    t.say(`${COPY.askContactConsent} ${consentCard("order_contact").text}`, this.contactUi(t));
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
      if (!c.consent) {
        this.askContactConsent(t);
        return;
      }
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
    await this.recordConsent(t, ["atendimento", "pedido"]);
    await this.db.conversation.update({ where: { id: t.conversation.id }, data: { leadId: lead.id } }).catch(() => undefined);
  }

  private async submitContact(t: Turn, input: { phone?: string; name?: string; email?: string; consent: boolean }) {
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

  private fulfillmentPrompt(t: Turn) {
    const options = this.fulfillmentOptions(t);
    t.state.awaiting = { kind: "fulfillment" };
    const fee = t.settings.deliveryEnabled ? ` Entrega: taxa de ${brl(t.settings.deliveryFeeCents)}.` : "";
    t.say(`${COPY.askFulfillment}${fee}`, { type: "fulfillment_choice", options });
    t.chips(...options.map((o) => (o.value === "delivery" ? CHIPS.delivery : CHIPS.pickup)));
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
    this.fulfillmentPrompt(t);
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
          `O pedido mínimo para entrega é ${brl(t.settings.minOrderCents)} e o seu está em ${brl(cart.subtotalCents)}. Você pode adicionar mais itens${t.settings.pickupEnabled ? " ou retirar na loja" : ""}.`,
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
      t.state.address = undefined;
      t.state.addressMasked = false;
      t.state.fulfillment = undefined;
      t.state.awaiting = { kind: "fulfillment" };
      t.say(COPY.outsideArea);
      t.chips(...(t.settings.pickupEnabled ? [CHIPS.pickup] : []), CHIPS.otherAddress, CHIPS.talkPharmacist);
      return;
    }
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
    const where = fulfillment === "delivery" ? `Entrega em: ${this.addressLabel(t)}` : "Retirada na loja";
    const lines = cart.items.map((i) => `${i.qty}× ${i.name} — ${brl(i.lineTotalCents)}`);
    const text = [
      "Seu pedido:",
      ...lines,
      ...(fulfillment === "delivery" ? [`Entrega: ${brl(fee)}`] : []),
      `Total: ${brl(total)}`,
      where,
      paymentLabel,
      ...notices,
    ].join("\n");
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
    t.chips(CHIPS.confirmOrder, CHIPS.changeItems, CHIPS.cancel);
  }

  private statusUrl(token: string): string {
    const base = (process.env.NEXT_PUBLIC_CHAT_URL ?? "http://localhost:3005").replace(/\/$/, "");
    return `${base}/pedido/${token}`;
  }

  private async confirmOrder(t: Turn) {
    const s = t.state;
    if (s.order && s.checkoutStep === "done" && s.cart.length === 0) {
      // Idempotent: a double tap never creates a second order.
      t.say(`O pedido ${s.order.code} já foi registrado. Acompanhe: ${s.order.statusUrl}`, {
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
      message = `Pedido ${created.code} confirmado! Acompanhe: ${url}`;
    } else if (created.hasPrescription) {
      message = `Pedido ${created.code} recebido. O farmacêutico vai validar a receita antes de confirmar. Acompanhe: ${url}`;
    } else if (created.staleSheet) {
      message = `Pedido ${created.code} recebido. O estoque que tenho aqui pode estar desatualizado, então a farmácia vai confirmar a disponibilidade antes de confirmar o pedido. Acompanhe: ${url}`;
    } else {
      message = `Pedido ${created.code} recebido. A farmácia confirma a disponibilidade em instantes. Acompanhe: ${url}`;
    }
    t.say(message, { type: "order_confirmation", code: created.code, status: created.status, statusUrl: url, totalCents: created.totalCents, message });
    t.chips(CHIPS.makeOrder);
  }

  // -------------------------------------------------------------------------------------------
  // General questions (lane F): deterministic facts from PharmacySettings; the rest goes to the model
  // -------------------------------------------------------------------------------------------

  private factsFor(t: Turn, topics: string[]): string[] {
    const s = t.settings;
    const lines: string[] = [];
    for (const topic of topics) {
      if (topic === "hours") {
        const hours = describeOpeningHours(s.openingHours);
        if (hours) {
          const open = isOpenNow(s.openingHours, t.business.timezone ?? "America/Sao_Paulo");
          lines.push(`Horário de atendimento — ${hours}.${open === null ? "" : open ? " Estamos abertos agora." : " No momento estamos fechados."}`);
        }
      } else if (topic === "delivery") {
        if (!s.deliveryEnabled) lines.push("A farmácia não faz entregas no momento.");
        else {
          const areas = s.deliveryAreas.length > 0 ? ` Atendemos: ${s.deliveryAreas.map((a) => (a.type === "cep_prefix" ? `CEP ${a.value}` : a.value)).join(", ")}.` : "";
          const min = s.minOrderCents > 0 ? ` Pedido mínimo para entrega: ${brl(s.minOrderCents)}.` : "";
          lines.push(`Entrega: taxa de ${brl(s.deliveryFeeCents)}.${min}${areas}`);
        }
      } else if (topic === "pickup") {
        lines.push(s.pickupEnabled ? "Você pode retirar o pedido na loja." : "A retirada em loja não está disponível no momento.");
      } else if (topic === "payment") {
        lines.push(`${paymentPhrase(s.paymentMethods, "delivery")}. O pagamento é feito só na entrega ou na retirada.`);
      } else if (topic === "exchange" && s.exchangePolicy) {
        lines.push(`Trocas e devoluções: ${s.exchangePolicy}`);
      } else if (topic === "min" && s.minOrderCents > 0) {
        lines.push(`Pedido mínimo para entrega: ${brl(s.minOrderCents)}.`);
      }
    }
    return lines;
  }

  private answerGeneral(t: Turn, combo: "hours+delivery") {
    const lines = this.factsFor(t, combo === "hours+delivery" ? ["hours", "delivery", "pickup"] : []);
    t.state.lane = "general";
    if (lines.length === 0) {
      t.say(COPY.unknownInfo);
      t.chips(CHIPS.talkPharmacist, CHIPS.makeOrder);
      return;
    }
    t.say(lines.join(" "));
    t.chips(CHIPS.makeOrder, CHIPS.talkPharmacist);
  }

  private answerGeneralFromText(t: Turn, f: string): boolean {
    const topics: string[] = [];
    if (RE.hours.test(f)) topics.push("hours");
    if (RE.deliveryInfo.test(f)) topics.push("delivery");
    if (RE.pickupInfo.test(f)) topics.push("pickup");
    if (RE.paymentInfo.test(f)) topics.push("payment");
    if (RE.exchangeInfo.test(f)) topics.push("exchange");
    if (RE.minOrder.test(f)) topics.push("min");
    if (topics.length === 0) return false;
    const lines = this.factsFor(t, topics);
    t.state.lane = "general";
    if (lines.length === 0) {
      t.say(COPY.unknownInfo);
      t.chips(CHIPS.talkPharmacist, CHIPS.makeOrder);
      return true;
    }
    t.say(lines.join(" "));
    t.chips(CHIPS.makeOrder, CHIPS.talkPharmacist);
    return true;
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
