import { Injectable, NotFoundException } from "@nestjs/common";
import { buildWaMeLink, buildCustomerEscalationMessage, generateReferenceCode } from "@realwise/shared";
import concessionariaFlow from "./flows/concessionaria.flow.json";
import imobiliariaFlow from "./flows/imobiliaria.flow.json";
import { PrismaService } from "../../prisma/prisma.service";
import { LeadsService } from "../leads/leads.service";
import { generateFromGateway } from "../../inference/gateway-client";
import { retrieveRelevantChunks } from "./knowledge-retrieval";
import { safeHttpUrl } from "../../common/safe-http-url";
import { ListingsService, ChatQueryFilters } from "../listings/listings.service";
import { BookingsService } from "../bookings/bookings.service";
import { AvailabilityService } from "../bookings/availability.service";
import { CalendarService } from "../calendar/calendar.service";

// Scripted nodes that are supposed to hand the visitor off to a real human WhatsApp number —
// their flow-JSON message templates have placeholders ({numero}, {espera}) that nothing ever
// resolves, since the flow engine has no concept of "this node means: build a real wa.me link."
const WHATSAPP_HANDOFF_NODE_IDS = new Set(["handoff_whats", "handoff_whatsapp"]);

// Scripted day/time-picking nodes that used to show fixed "Hoje"/"Amanhã"/"{horario_1..3}"
// placeholder bubbles with no real backend effect — now backed by AvailabilityService.computeSlots
// when the business has configured real availability rules.
const BOOKING_DAY_NODE_IDS = new Set(["visita_dia", "agend_dia"]);
const BOOKING_PERIOD_NODE_IDS = new Set(["visita_periodo", "agend_periodo"]);
const BOOKING_TIME_NODE_IDS = new Set(["visita_horario", "agend_horario"]);

// Terminal confirmation nodes reached right after the visitor taps the final "✅ Confirmar"
// bubble — these are where a real Appointment should actually be created.
const BOOKING_CONFIRM_NODE_IDS = new Set(["visita_confirmada", "agend_ok"]);

// Nodes that capture a visitor's email address right after a booking is confirmed (the
// "📅 Adicionar ao calendário" bubble routes here instead of straight to the *_ok node) — see
// tryCaptureVisitorEmail below.
const EMAIL_CAPTURE_NODE_IDS = new Set(["visita_email", "agend_email"]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Only "visita_local" (in-person) exists as a modeled AppointmentType today (see AppointmentType
// enum in packages/db/prisma/schema.prisma) — both the imobiliaria property visit and the
// concessionaria test-drive/showroom-visit flows are in-person, so both map to it.
const BOOKING_APPOINTMENT_TYPE = "visita_local" as const;

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
  // Optional — matches ListingsService's own ListingItem shape (id is present for real DB-backed
  // rows, absent for the live-LLM-extraction fallback path, which has no backing Listing row).
  id?: string;
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

// Per-vehicle detail nodes whose message template is genuinely bound to ONE specific real
// listing (brand/model/year/mileage/price) — these must never fall through to the generic
// LLM-prose fallback, which has no real listing to ground on and will invent specifics (e.g. a
// fabricated "BMW 2018, 30.000km, R$90.000" that doesn't exist in inventory).
const LISTING_DETAIL_NODE_IDS = new Set(["carro_detalhe", "carro_fotos"]);

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
    private readonly listingsService: ListingsService,
    private readonly bookings: BookingsService,
    private readonly availability: AvailabilityService,
    private readonly calendar: CalendarService,
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
  ): Promise<{ message: string; listings?: ListingItem[]; whatsappUrl?: string | null; bubblesOverride?: FlowBubble[] }> {
    const substituted = this.substitute(node.message, params);

    if (WHATSAPP_HANDOFF_NODE_IDS.has(node.id)) {
      return this.resolveWhatsappHandoff(businessId, conversationId, substituted);
    }

    if (BOOKING_CONFIRM_NODE_IDS.has(node.id)) {
      const booking = await this.tryCreateBooking(businessId, conversationId, params);
      // Only short-circuit when the visitor actually came through the real slot-picker (slot_start/
      // slot_end present in params) — otherwise fall through unchanged to the existing RAG-fallback
      // confirmation text below (old saved conversation, or business with no availability configured).
      if (booking) return booking;
    }

    // Listing-detail nodes are bound to ONE specific real listing — never let these fall through
    // to the generic RAG-prose fallback below, which has no real listing to ground on.
    if (LISTING_DETAIL_NODE_IDS.has(node.id)) {
      return this.resolveListingDetail(businessId, node, params);
    }

    if (!PLACEHOLDER_PATTERN.test(substituted)) return { message: substituted };

    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) return { message: substituted.replace(PLACEHOLDER_PATTERN, "") };

    if (LISTING_NODE_IDS.has(node.id)) {
      // Phase 2: businesses with a real extracted Listing table query that table directly instead
      // of paying for a fresh LLM extraction on every "resultados" hit. New businesses (or ones
      // whose first extraction hasn't run yet) have zero rows and fall through unchanged to the
      // live-LLM extraction path below.
      const hasListings = await this.listingsService.hasAnyListings(businessId);
      if (hasListings) {
        const filters = this.chatFiltersFor(business.niche, params);
        const dbListings = await this.listingsService.queryForChat(businessId, filters, 6);
        if (dbListings.length > 0) {
          // Mutates the same `params` object the caller holds a reference to (advance() stores
          // THIS object as the conversation's flowParams) so a later bubble tap into
          // carro_detalhe/carro_fotos with no listing-specific context can still resolve to the
          // single listing just shown — see resolveListingId below.
          params.last_listing_ids = dbListings.map((l) => l.id).filter((id): id is string => Boolean(id));
          return { message: "Encontrei algumas opções que podem te interessar 👇", listings: dbListings };
        }
        // Real inventory exists but nothing matches the visitor's chosen filters — route
        // explicitly to the flow's own "sem_resultados" node (real bubbles that actually narrow
        // the search) instead of falling through to the generic LLM-prose fallback below, which
        // has no grounded way to explain an empty result honestly.
        const flow = this.flowFor(business.niche);
        const semResultados = flow.nodes.sem_resultados;
        if (semResultados) {
          return { message: semResultados.message, bubblesOverride: semResultados.bubbles ?? [] };
        }
      } else {
        // The literal node message ("Encontrei {n} imóveis para você") is a bad retrieval query —
        // it's generic UI copy, not a description of an actual listing, so it tends to rank
        // nav/footer/form chunks above the real listing cards. Build the query from the filters
        // the visitor actually picked instead, so retrieval is biased toward genuine inventory text.
        const listingQuery = this.listingQueryFor(business.niche, params);
        const listingChunks = await retrieveRelevantChunks(this.prisma, businessId, listingQuery);
        const listingChunkText = listingChunks.map((c) => c.content).join("\n\n").slice(0, 8000);
        const listings = await this.extractListings(businessId, business.name, listingChunkText);
        if (listings.length > 0) {
          return { message: "Encontrei algumas opções que podem te interessar 👇", listings };
        }
        // Nothing to ground on at all — no Listing rows AND nothing genuinely listing-shaped in
        // the ingested documents either. The generic RAG-prose fallback below has, in practice,
        // invented specific vehicles/properties on exactly this "truly empty" case despite its own
        // grounding instructions — so this is an honest dead end, not a prompt to improve: offer a
        // real human handoff instead of ever reaching that fallback.
        return {
          message:
            business.niche === "concessionaria"
              ? "Ainda não tenho o estoque carregado aqui — quer falar com um vendedor para ver as opções disponíveis?"
              : "Ainda não tenho os imóveis carregados aqui — quer falar com um corretor para ver as opções disponíveis?",
          bubblesOverride: [
            {
              label: business.niche === "concessionaria" ? "Falar com um vendedor" : "Falar com um corretor",
              goto: "handoff_whats",
            },
            { label: "⬅ Voltar ao menu", goto: "start" },
          ],
        };
      }
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

  // The flow engine has no per-card bubble mechanism — "resultados" renders multiple real
  // listings as cards (frontend-only, via ListingCards/ListingDetailOverlay), but the single
  // scripted "🔍 Ver detalhes" bubble has no way to carry which card the visitor actually meant.
  // Resolves, in priority order: an explicit `listing_id` param (future per-card bubble
  // attachment), or the single listing from the last "resultados" hit when exactly one was shown
  // (`last_listing_ids`, set in resolveMessage's LISTING_NODE_IDS branch). Ambiguous (0 or 2+
  // candidates) returns null rather than guessing — same discipline as
  // ListingsService.findMentionedForChat.
  private resolveListingId(params: Record<string, unknown>): string | null {
    if (typeof params.listing_id === "string" && params.listing_id) return params.listing_id;
    const lastIds = params.last_listing_ids;
    if (Array.isArray(lastIds) && lastIds.length === 1 && typeof lastIds[0] === "string") return lastIds[0];
    return null;
  }

  // carro_detalhe/carro_fotos: binds the node to one real Listing row instead of ever falling
  // through to the generic RAG-prose fallback. Returns a clarifying message (never a guess) when
  // no specific listing can be resolved, and an honest "not available anymore" message when the
  // resolved listing_id no longer exists (deleted/sold between the card being shown and tapped).
  private async resolveListingDetail(
    businessId: string,
    node: FlowNode,
    params: Record<string, unknown>,
  ): Promise<{ message: string; listings?: ListingItem[]; bubblesOverride?: FlowBubble[] }> {
    const backToResults: FlowBubble[] = [{ label: "⬅ Voltar aos resultados", goto: "resultados" }];
    const listingId = this.resolveListingId(params);
    if (!listingId) {
      return { message: "Qual carro você quer ver? Toque em 🔍 Ver detalhes em um dos carros que te mostrei 👇", bubblesOverride: backToResults };
    }

    let listing;
    try {
      listing = await this.listingsService.getOne(businessId, listingId);
    } catch {
      return { message: "Esse carro não está mais disponível. Vamos ver outras opções?", bubblesOverride: backToResults };
    }

    if (node.id === "carro_fotos") {
      const images = await this.listingsService.getImagesForChat(businessId, listingId);
      if (images.length === 0) {
        return { message: "Ainda não tenho fotos cadastradas para esse carro — mas posso te passar os outros detalhes que tenho 👇" };
      }
      return { message: "Aqui estão as fotos 📸", listings: images };
    }

    // carro_detalhe: build the message from real columns only — fields the business never filled
    // in simply don't appear, rather than rendering a placeholder.
    const parts: string[] = [];
    const brandModel = [listing.brand, listing.model].filter(Boolean).join(" ");
    if (brandModel) parts.push(brandModel);
    if (listing.year) parts.push(String(listing.year));
    if (listing.mileageKm != null) parts.push(`${listing.mileageKm.toLocaleString("pt-BR")} km`);
    if (listing.priceText) parts.push(listing.priceText);

    const message = `${parts.length > 0 ? parts.join(" — ") : listing.title}. O que você quer ver?`;
    const image = listing.images[0]?.url ? safeHttpUrl(listing.images[0].url) : undefined;
    const url = safeHttpUrl(listing.url ?? undefined);
    return {
      message,
      listings: [
        {
          id: listing.id,
          title: listing.title,
          ...(listing.priceText ? { price: listing.priceText } : {}),
          ...(url ? { url } : {}),
          ...(image ? { imageUrl: image } : {}),
        },
      ],
    };
  }

  // Closes the "scripted booking is cosmetic" gap: visita_confirmada/agend_ok used to always show
  // a static "{corretor}"/"{vendedor}" RAG-fallback sentence with no real backend effect. When the
  // visitor actually came through the real slot-picker bubbles (slot_start/slot_end present in
  // params), this creates a real Appointment via BookingsService (shared with ChatService's own
  // "agendar" booking-card path, avoiding a FlowService <-> ChatService import cycle) and returns a
  // message stating the real booked date/time. Returns null when slot_start/slot_end are missing so
  // the caller falls through to the existing generic confirmation behavior unchanged.
  private async tryCreateBooking(
    businessId: string,
    conversationId: string,
    params: Record<string, unknown>,
  ): Promise<{ message: string } | null> {
    const slotStart = params.slot_start;
    const slotEnd = params.slot_end;
    if (typeof slotStart !== "string" || typeof slotEnd !== "string") return null;

    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) return null;
    const conversation = await this.prisma.client.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) return null;

    const startsAt = new Date(slotStart);
    const endsAt = new Date(slotEnd);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      return { message: "Esse horário não é mais válido. Vamos escolher outro horário? 👉 Toque em \"Nenhum serve\" para ver os horários atuais." };
    }

    // Re-validate the slot is still free right before creating — time passes between the visitor
    // picking a slot and tapping "Confirmar", and someone else could have booked it meanwhile.
    // computeSlots already subtracts existing appointments, so this is a cheap, honest re-check.
    const { configured, slots } = await this.availability.computeSlots(businessId, {
      appointmentType: BOOKING_APPOINTMENT_TYPE,
      from: startsAt,
      to: endsAt,
    });
    const stillOpen = configured && slots.some((s) => s.startsAt === startsAt.toISOString() && s.endsAt === endsAt.toISOString());
    if (!stillOpen) {
      return { message: "Esse horário acabou de ser reservado por outra pessoa. Vamos escolher outro horário? 👉 Toque em \"Nenhum serve\" para ver os horários atuais." };
    }

    const serviceName = business.niche === "concessionaria" ? "Test-drive" : "Visita ao imóvel";

    // Best-effort: resolve which listing was actually discussed in this conversation so the
    // appointment (and its confirmation emails/ICS) can reference the right address/listing
    // details — the same conservative single-match mechanism used elsewhere for listing cards.
    const recentMessages = await this.prisma.client.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { content: true },
    });
    const haystack = recentMessages.map((m) => m.content).join("\n");
    const matched = await this.listingsService.findMentionedForChat(businessId, haystack, 1);
    const listingId = matched[0]?.id ?? null;

    const appointment = await this.bookings.createAppointmentAndNotify(
      businessId,
      conversation.leadId ?? undefined,
      conversationId,
      serviceName,
      startsAt,
      endsAt,
      "chat",
      BOOKING_APPOINTMENT_TYPE,
      listingId,
    );
    this.calendar.createEvent(businessId, appointment).catch(() => {});

    const timezone = business.timezone ?? "America/Sao_Paulo";
    const formatted = startsAt.toLocaleString("pt-BR", { timeZone: timezone, dateStyle: "short", timeStyle: "short" });
    const label = business.niche === "concessionaria" ? "Agendado" : "Visita agendada";
    return { message: `${label}! 🎉 Confirmado para ${formatted}.` };
  }

  // Calendar-day key in the business's own timezone (YYYY-MM-DD) — used to group/filter real
  // computeSlots() results by the date a visitor tapped, rather than by raw UTC instants.
  private dateKeyInTimezone(iso: string, timezone: string): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  }

  private periodoBucket(iso: string, timezone: string): "manha" | "tarde" | "noite" {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hour12: false }).format(new Date(iso)));
    if (hour < 12) return "manha";
    if (hour < 18) return "tarde";
    return "noite";
  }

  private formatDateLabel(dateKey: string, timezone: string): string {
    const [year, month, day] = dateKey.split("-").map(Number);
    // Weekday-only formatting doesn't need the real timezone offset (we already resolved the
    // calendar day) — noon UTC on that calendar day avoids any DST-adjacent edge case.
    const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(noonUtc);
    const capitalized = weekday.charAt(0).toUpperCase() + weekday.slice(1);
    return `${capitalized}, ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
  }

  private formatTimeLabel(iso: string, timezone: string): string {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: timezone, hour12: false }).format(new Date(iso));
  }

  // visita_dia/agend_dia: groups real open slots (next 14 days, capped per computeSlots itself)
  // by calendar date and emits one bubble per real upcoming date that has at least one slot,
  // capped at 7 distinct dates. Returns null (meaning: fall back to the existing static
  // "Hoje"/"Amanhã"/"Esta semana" bubbles) whenever the business hasn't configured real
  // availability yet — same honesty principle as the listing fallback in resolveMessage().
  private async dayBubbles(businessId: string, nodeId: string): Promise<FlowBubble[] | null> {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) return null;
    const timezone = business.timezone ?? "America/Sao_Paulo";

    const now = new Date();
    const to = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const { configured, slots } = await this.availability.computeSlots(businessId, {
      appointmentType: BOOKING_APPOINTMENT_TYPE,
      from: now,
      to,
    });
    if (!configured) return null;

    const dateKeys = [...new Set(slots.map((s) => this.dateKeyInTimezone(s.startsAt, timezone)))].sort().slice(0, 7);
    if (dateKeys.length === 0) {
      return [{ label: "Nenhum horário disponível no momento", goto: "handoff" }];
    }

    const periodoGoto = nodeId === "visita_dia" ? "visita_periodo" : "agend_periodo";
    return dateKeys.map((dateKey) => ({
      label: this.formatDateLabel(dateKey, timezone),
      goto: periodoGoto,
      params: { booking_date: dateKey },
    }));
  }

  // visita_periodo/agend_periodo: kept as a real coarse filter (manhã <12h / tarde 12-18h / fim de
  // tarde >=18h) once a real date has been picked — only buckets that actually have ≥1 real slot
  // that day are shown. Falls back to null (static Manhã/Tarde/Fim de tarde bubbles unchanged)
  // whenever booking_date isn't present in params, i.e. the visitor is on the static fallback path.
  private async periodoBubbles(businessId: string, nodeId: string, params: Record<string, unknown>): Promise<FlowBubble[] | null> {
    const dateKey = params.booking_date;
    if (typeof dateKey !== "string") return null;

    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) return null;
    const timezone = business.timezone ?? "America/Sao_Paulo";
    const dayGoto = nodeId === "visita_periodo" ? "visita_dia" : "agend_dia";

    const [year, month, day] = dateKey.split("-").map(Number);
    // Widen the query range by a day on each side since the local calendar day in `timezone`
    // doesn't align with UTC midnight.
    const from = new Date(Date.UTC(year, month - 1, day - 1, 0, 0, 0));
    const to = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
    const { configured, slots } = await this.availability.computeSlots(businessId, {
      appointmentType: BOOKING_APPOINTMENT_TYPE,
      from,
      to,
    });
    if (!configured) return null;

    const daySlots = slots.filter((s) => this.dateKeyInTimezone(s.startsAt, timezone) === dateKey);
    const horarioGoto = nodeId === "visita_periodo" ? "visita_horario" : "agend_horario";
    const buckets: Array<{ key: "manha" | "tarde" | "noite"; label: string }> = [
      { key: "manha", label: "Manhã" },
      { key: "tarde", label: "Tarde" },
      { key: "noite", label: "Fim de tarde" },
    ];
    const withSlots = buckets.filter((b) => daySlots.some((s) => this.periodoBucket(s.startsAt, timezone) === b.key));
    if (withSlots.length === 0) {
      return [{ label: "Nenhum horário disponível, tente outro dia", goto: dayGoto }];
    }
    return withSlots.map((b) => ({ label: b.label, goto: horarioGoto, params: { booking_date: dateKey, booking_periodo: b.key } }));
  }

  // visita_horario/agend_horario: given the date (and optional period) picked earlier, emits one
  // bubble per real open time slot, capped at 8. Falls back to null (static {horario_1..3}
  // placeholder bubbles, which resolveMessage's generic RAG fallback already handles honestly)
  // whenever booking_date isn't present in params.
  private async timeBubbles(businessId: string, nodeId: string, params: Record<string, unknown>): Promise<FlowBubble[] | null> {
    const dateKey = params.booking_date;
    if (typeof dateKey !== "string") return null;

    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) return null;
    const timezone = business.timezone ?? "America/Sao_Paulo";
    const dayGoto = nodeId === "visita_horario" ? "visita_dia" : "agend_dia";
    const confirmGoto = nodeId === "visita_horario" ? "visita_confirmar" : "agend_confirmar";

    const [year, month, day] = dateKey.split("-").map(Number);
    const from = new Date(Date.UTC(year, month - 1, day - 1, 0, 0, 0));
    const to = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
    const { configured, slots } = await this.availability.computeSlots(businessId, {
      appointmentType: BOOKING_APPOINTMENT_TYPE,
      from,
      to,
    });
    if (!configured) return null;

    let daySlots = slots.filter((s) => this.dateKeyInTimezone(s.startsAt, timezone) === dateKey);
    const periodo = params.booking_periodo;
    if (typeof periodo === "string") {
      daySlots = daySlots.filter((s) => this.periodoBucket(s.startsAt, timezone) === periodo);
    }
    daySlots = daySlots.slice(0, 8);

    if (daySlots.length === 0) {
      // Defends against a race (another visitor booked every slot for that date/period between
      // the day bubble appearing and this tap) — route back to the date-picker honestly instead
      // of showing broken/empty time bubbles.
      return [{ label: "Nenhum horário disponível, tente outro dia", goto: dayGoto }];
    }

    return daySlots.map((s) => ({
      label: this.formatTimeLabel(s.startsAt, timezone),
      goto: confirmGoto,
      params: { slot_start: s.startsAt, slot_end: s.endsAt, booking_date: dateKey },
    }));
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

  // "faixa" bubbles encode a numbered price bucket (or "any"), not a raw price — boundaries come
  // straight from the bubble labels in the flow JSON (apps/api/src/modules/chat/flows/*.flow.json,
  // "busca_preco" node) and differ for imobiliaria aluguel vs venda vs concessionaria.
  private static readonly FAIXA_BUCKETS_ALUGUEL: Array<[number | null, number | null]> = [
    [null, 150000],
    [150000, 250000],
    [250000, 400000],
    [400000, 600000],
    [600000, null],
  ];
  private static readonly FAIXA_BUCKETS_VENDA: Array<[number | null, number | null]> = [
    [null, 30000000],
    [30000000, 50000000],
    [50000000, 80000000],
    [80000000, 120000000],
    [120000000, null],
  ];
  private static readonly FAIXA_BUCKETS_VEICULO: Array<[number | null, number | null]> = [
    [null, 4000000],
    [4000000, 6000000],
    [6000000, 8000000],
    [8000000, 12000000],
    [12000000, 20000000],
    [20000000, null],
  ];

  private faixaToPriceRange(niche: string, transaction: string | undefined, faixa: unknown): { priceMin?: number; priceMax?: number } {
    const index = typeof faixa === "number" ? faixa : typeof faixa === "string" ? Number(faixa) : NaN;
    if (!Number.isFinite(index) || index < 1) return {};
    const buckets =
      niche === "concessionaria"
        ? FlowService.FAIXA_BUCKETS_VEICULO
        : transaction === "venda"
          ? FlowService.FAIXA_BUCKETS_VENDA
          : FlowService.FAIXA_BUCKETS_ALUGUEL;
    const bucket = buckets[index - 1];
    if (!bucket) return {};
    const [min, max] = bucket;
    return { ...(min != null && { priceMin: min }), ...(max != null && { priceMax: max }) };
  }

  // Maps the flow's accumulated filter params (tipo/modo/faixa/regiao/marca/modelo/ordem) onto
  // ListingsService.queryForChat's filter shape, used once the business has real extracted rows.
  private chatFiltersFor(niche: string, params: Record<string, unknown>): ChatQueryFilters {
    const transaction = typeof params.modo === "string" && params.modo !== "any" ? params.modo : undefined;
    const { priceMin, priceMax } = this.faixaToPriceRange(niche, transaction, params.faixa);
    return {
      ...(typeof params.tipo === "string" && params.tipo !== "any" && { listingType: params.tipo }),
      ...(transaction && { transaction }),
      ...(priceMin != null && { priceMin }),
      ...(priceMax != null && { priceMax }),
      ...(typeof params.regiao === "string" && params.regiao !== "any" && params.regiao !== "geo" && { neighborhood: params.regiao }),
      ...(typeof params.marca === "string" && params.marca !== "any" && { brand: params.marca }),
      ...(typeof params.modelo === "string" && params.modelo !== "any" && { model: params.modelo }),
      ...(typeof params.ordem === "string" && { ordem: params.ordem }),
    };
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
        temperature: 0.1,
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
  // `chunkText` is optional and, when given, lets intent-only messages ("me mostre os
  // disponíveis") still count as a listing query when the item itself was only named earlier in
  // the conversation (e.g. "Creta" a few turns back) — the retrieved chunk text is grounded in
  // what the RAG pipeline actually found for THIS turn, so if it genuinely contains item words,
  // that's a more reliable signal than requiring the item word in this exact message's raw text.
  isListingQuery(visitorText: string, chunkText?: string): boolean {
    const normalized = normalize(visitorText);
    const itemWords = ["imovel", "imoveis", "casa", "casas", "apartamento", "apartamentos", "carro", "carros", "veiculo", "veiculos"];
    const intentWords = ["disponivel", "disponiveis", "tem", "tem disponivel", "mostra", "mostre", "ver", "listar", "quais", "opcoes", "opcao"];
    const hasItemWord = itemWords.some((w) => normalized.includes(w));
    const hasIntentWord = intentWords.some((w) => normalized.includes(w));
    if (hasItemWord && hasIntentWord) return true;
    if (!hasIntentWord || !chunkText) return false;
    const normalizedChunk = normalize(chunkText);
    return itemWords.some((w) => normalizedChunk.includes(w));
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

    const hasEntry = business.cachedLocationsAt != null && Array.isArray(business.cachedLocations);
    const isFresh = hasEntry && Date.now() - business.cachedLocationsAt!.getTime() < 12 * 3600 * 1000;

    if (!force && hasEntry) {
      // Stale-while-revalidate: a cache entry exists (even if expired) — return it immediately and,
      // if it's stale, kick off a fire-and-forget refresh for next time instead of blocking this
      // visitor-facing request on a live LLM extraction call.
      if (!isFresh) this.dynamicRegionBubbles(businessId, true).catch(() => {});
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
          // Only reached on a genuinely cold cache (no entry at all) when this call is blocking the
          // visitor-facing request — fail fast instead of hanging for the default 25s on a
          // saturated gateway. Background force-refresh calls aren't on the request path, so they
          // can afford the default timeout.
          ...(hasEntry ? {} : { timeoutMs: 8000 }),
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
    const isFresh = Boolean(entry) && Date.now() - new Date(entry!.at).getTime() < 12 * 3600 * 1000;

    if (!force && entry) {
      // Stale-while-revalidate: an entry exists (even if expired) — return it immediately and, if
      // it's stale, kick off a fire-and-forget refresh for next time instead of blocking this
      // visitor-facing request on a live LLM extraction call.
      if (!isFresh) this.extractOptions(businessId, cacheKey, systemPrompt, true).catch(() => {});
      return entry.values;
    }

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
          // Only reached on a genuinely cold cache (no entry at all) when this call is blocking
          // the visitor-facing request — fail fast instead of hanging on a saturated gateway.
          // Background force-refresh calls aren't on the request path, so they keep the default.
          ...(entry ? {} : { timeoutMs: 8000 }),
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
        if (slice.length === 0) return null;
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
        if (models.length === 0) return null;
        return models.map((name) => ({
          label: name,
          goto,
          params: { modelo: name },
        }));
      }
      case "busca_categoria": {
        const categories = await this.extractOptions(businessId, "categoria_veiculo", VEHICLE_CATEGORY_PROMPT);
        if (categories.length === 0) return null;
        return categories.map((name) => ({ label: name, goto: "busca_marca", params: { categoria: name } }));
      }
      case "busca_tipo": {
        // Businesses with a real extracted Listing table build type bubbles from actual inventory
        // rows instead of paying for an LLM extraction call on every visitor-facing hit — this is
        // also what keeps this node off the blocking extractOptions() path once inventory exists.
        const hasListings = await this.listingsService.hasAnyListings(businessId);
        if (hasListings) {
          const dbTypes = await this.listingsService.distinctListingTypes(businessId);
          if (dbTypes.length === 0) return null;
          return dbTypes.map((name) => ({ label: name, goto: "busca_preco", params: { tipo: name } }));
        }
        const types = await this.extractOptions(businessId, "categoria_imovel", PROPERTY_TYPE_PROMPT);
        if (types.length === 0) return null;
        return types.map((name) => ({ label: name, goto: "busca_preco", params: { tipo: name } }));
      }
      default:
        if (BOOKING_DAY_NODE_IDS.has(nodeId)) return this.dayBubbles(businessId, nodeId);
        if (BOOKING_PERIOD_NODE_IDS.has(nodeId)) return this.periodoBubbles(businessId, nodeId, params);
        if (BOOKING_TIME_NODE_IDS.has(nodeId)) return this.timeBubbles(businessId, nodeId, params);
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
        // Day/period bubbles are replaced in full by the real dynamic options when they fire —
        // mixing the old static "Hoje"/"Manhã" bubbles alongside real dates/periods would be
        // confusing. Time bubbles only strip the unresolved {horario_N} placeholders, keeping the
        // "Nenhum serve" nav bubble intact as a real fallback regardless.
        if (BOOKING_DAY_NODE_IDS.has(nodeId) || BOOKING_PERIOD_NODE_IDS.has(nodeId)) return true;
        if (BOOKING_TIME_NODE_IDS.has(nodeId)) return typeof bubble.label === "string" && bubble.label.startsWith("{horario_");
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
    const { message, listings, whatsappUrl, bubblesOverride } = await this.resolveMessage(businessId, conversationId, node, params);

    let bubbles: FlowBubble[];
    // Number of leading bubbles in `bubbles` that are dynamic/contextual (derived from the
    // business's real data) rather than the node's own scripted JSON bubbles — used by
    // finalizeBubbles to decide trim priority (dynamic bubbles are trimmed last).
    let dynamicCount = 0;
    if (bubblesOverride) {
      // resolveMessage decided the node's own scripted bubbles don't apply right now (e.g. a
      // clarifying "which car?" message, or an explicit redirect to "sem_resultados"'s own
      // bubbles) — use exactly what it returned instead of the node's JSON bubbles.
      bubbles = bubblesOverride;
    } else if (node.id === "busca_bairro") {
      // Only the location-agnostic bubbles from the script ("Perto de mim" / "Tanto faz") plus
      // real region names derived from the business's own documents — no hardcoded zone list.
      const locationAgnostic = (node.bubbles ?? []).filter(
        (b) => b.params?.regiao === "geo" || b.params?.regiao === "any",
      );
      const regions = await this.dynamicRegionBubbles(businessId);
      bubbles = [...regions, ...locationAgnostic, ...flow.global_bubbles];
      dynamicCount = regions.length;
    } else {
      const dynamicOptions = await this.dynamicOptionBubbles(businessId, node.id, params);
      if (dynamicOptions) {
        // Nav/fallback bubbles are whatever's left in the script once the hardcoded option
        // bubbles are stripped (e.g. "Tanto faz", "Qualquer modelo", "Outra", back-links).
        const nav = (node.bubbles ?? []).filter((b) => !this.isHardcodedOptionBubble(node.id, b));
        bubbles = [...dynamicOptions, ...nav, ...flow.global_bubbles];
        dynamicCount = dynamicOptions.length;
      } else {
        bubbles = [...(node.bubbles ?? []), ...flow.global_bubbles];
      }
    }

    return {
      nodeId: node.id,
      message,
      bubbles: this.finalizeBubbles(this.ensureNonEmptyBubbles(node, bubbles, niche), dynamicCount),
      input: node.input ?? null,
      params,
      ...(listings ? { listings } : {}),
      ...(whatsappUrl !== undefined ? { whatsappUrl } : {}),
    };
  }

  // Last-resort guard: if every bubble source above produced nothing (e.g. dynamic extraction
  // stripped all hardcoded options as "nav" and returned no real options itself — a new business
  // with no ingested documents yet, or a failed/unparseable LLM extraction call), fall back to the
  // node's own unfiltered scripted bubbles rather than leaving the visitor with no options at all.
  // If even those are empty (a flow-authoring gap), fall back to a single safety-net bubble —
  // niche-aware real question rather than generic nav, since bubbles should read as specific
  // questions, not navigation — this is not a reintroduction of the removed persistent nav layer,
  // it only ever appears when every other option-generation path has failed.
  private ensureNonEmptyBubbles(node: FlowNode, bubbles: FlowBubble[], niche: string): FlowBubble[] {
    if (bubbles.length > 0) return bubbles;
    if (node.bubbles && node.bubbles.length > 0) {
      console.warn(`[flow] ensureNonEmptyBubbles tier 2 fallback fired for node "${node.id}" — extraction returned no bubbles.`);
      return node.bubbles;
    }
    console.warn(`[flow] ensureNonEmptyBubbles tier 3 fallback fired for node "${node.id}" — no bubbles on node either.`);
    const label = niche === "concessionaria" ? "Quais carros vocês têm disponíveis?" : "Quais imóveis vocês têm disponíveis?";
    return [{ label, goto: "start" }];
  }

  // Human-handoff node ids a bubble can point at — "Falar com corretor"/"Falar com vendedor"
  // bubbles all land the visitor in the same place.
  private static readonly HANDOFF_GOTOS = new Set(["atendente", "handoff"]);
  private static readonly MAX_BUBBLES = 5;

  // Generic nav-ish label patterns, deprioritized in trimming order below — the full relabeling
  // sweep of the flow JSONs themselves is a separate later task, this only affects which bubbles
  // survive the cap.
  private static readonly NAV_LABEL_PATTERN = /^(voltar|menu|tanto faz|ver outras op|outra)/i;

  // Caps the total at MAX_BUBBLES using tiered trimming, trimming from the END of each tier
  // (preserving each tier's original relative order) before moving on to the next tier:
  //   Tier 1 (trimmed last)  — dynamic/contextual bubbles (real brand/model/region/type values
  //                            derived from the business's own data), i.e. the first `dynamicCount`
  //                            entries in `bubbles`.
  //   Tier 2                 — the node's own scripted bubbles, in their original JSON order.
  //   Tier 3 (trimmed first) — navigation-shaped bubbles: goto === "start", goto in HANDOFF_GOTOS/
  //                            WHATSAPP_HANDOFF_NODE_IDS, or a generic nav-looking label.
  // Nav bubbles are deliberately NOT protected from trimming — per product direction, bubbles
  // should read as specific questions, not navigation, so a nav bubble is the first thing cut when
  // the list is too long, not the last.
  private finalizeBubbles(bubbles: FlowBubble[], dynamicCount = 0): FlowBubble[] {
    if (bubbles.length <= FlowService.MAX_BUBBLES) return bubbles;

    const isNav = (b: FlowBubble) =>
      b.goto === "start" ||
      FlowService.HANDOFF_GOTOS.has(b.goto) ||
      WHATSAPP_HANDOFF_NODE_IDS.has(b.goto) ||
      FlowService.NAV_LABEL_PATTERN.test(b.label);

    const tier1: FlowBubble[] = [];
    const tier2: FlowBubble[] = [];
    const tier3: FlowBubble[] = [];
    bubbles.forEach((b, i) => {
      if (i < dynamicCount) tier1.push(b);
      else if (isNav(b)) tier3.push(b);
      else tier2.push(b);
    });

    // Fill the budget tier-by-tier, trimming from the end of whichever tier is cut, lowest
    // priority (tier3) first.
    const budget = FlowService.MAX_BUBBLES;
    const keepTier3 = tier3.slice(0, Math.max(0, budget - tier1.length - tier2.length));
    const remainingAfterTier3 = Math.max(0, budget - keepTier3.length);
    const keepTier2 = tier2.slice(0, Math.max(0, remainingAfterTier3 - tier1.length));
    const remainingAfterTier2 = Math.max(0, budget - keepTier3.length - keepTier2.length);
    const keepTier1 = tier1.slice(0, remainingAfterTier2);

    const survivors = new Set([...keepTier1, ...keepTier2, ...keepTier3]);
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
      // Only persisted on the FIRST start() for a conversation (guarded by the same
      // !conversation.flowNodeId check as the flowNodeId/flowHistory bootstrap above) — a
      // conversation that's already started never re-runs this branch, so there's no risk of
      // double-writing this opening message on a repeated start() call for the same conversation.
      await this.prisma.client.message.create({
        data: { conversationId, businessId, role: "assistant", content: snapshot.message, answerSource: "fixed_flow" },
      });
    }

    return snapshot;
  }

  async advance(
    businessId: string,
    conversationId: string,
    goto: string,
    bubbleParams: Record<string, unknown> = {},
    bubbleLabel?: string,
    // ChatService's own on_input/matchFreeTextBubble redirects already persist both the
    // visitor's real typed text (before calling advance()) and their own "assistant" Message row
    // right after — passing false there avoids writing a duplicate assistant row for the same
    // turn. The real bubble-tap path (ChatController -> advance()) has nothing else persisting
    // either side, so it keeps the default of true.
    persistAssistantMessage = true,
  ) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException("Business not found");

    const conversation = await this.currentState(conversationId);
    const history = (conversation.flowHistory as unknown as FlowSnapshot[]) ?? [];

    const currentSnapshot = (conversation.flowSnapshot as unknown as FlowSnapshot) ?? null;
    const mergedParams = { ...(conversation.flowParams as Record<string, unknown>), ...bubbleParams };

    // Persist the visitor's bubble-tap BEFORE advancing, same ordering as a real typed message —
    // best-effort only (a scripted bubble tap should never fail because of a logging write).
    // `bubbleLabel` is only sent by an actual bubble tap, not matchFreeTextBubble's free-text
    // shortcut or tryCaptureVisitorEmail's on_input redirect, which already persist (or don't
    // need to persist) the visitor's real typed text through the normal chat message path.
    if (bubbleLabel) {
      this.prisma.client.message
        .create({ data: { conversationId, businessId, role: "visitor", content: bubbleLabel } })
        .catch(() => {});
    }

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

    // Best-effort, mirrors the visitor-side write above — a conversation driven entirely by
    // bubble taps previously never created any Message rows at all (only resolveWhatsappHandoff
    // did), so history/refresh for a pure-bubble conversation came back completely empty.
    if (persistAssistantMessage) {
      this.prisma.client.message
        .create({ data: { conversationId, businessId, role: "assistant", content: nextSnapshot.message, answerSource: "fixed_flow" } })
        .catch(() => {});
    }

    this.recomputeLeadScore(businessId, conversation.leadId);
    return nextSnapshot;
  }

  // Called right before ChatService's normal on_input/free-text advance logic runs, whenever the
  // visitor is currently sitting at an EMAIL_CAPTURE_NODE_IDS node (reached via the "📅 Adicionar
  // ao calendário" bubble in visita_confirmada/agend_ok). If the typed text is a plausible email,
  // stores it on the lead and re-sends just the visitor's booking confirmation email (with the
  // .ics attached) for whichever appointment was created in this conversation in the last hour.
  // Returns false (without storing anything) for non-matching node ids or invalid-looking text —
  // the caller's existing on_input advance then proceeds unchanged either way.
  async tryCaptureVisitorEmail(businessId: string, conversationId: string, visitorText: string): Promise<boolean> {
    const conversation = await this.prisma.client.conversation.findFirst({ where: { id: conversationId, businessId } });
    if (!conversation?.flowNodeId || !EMAIL_CAPTURE_NODE_IDS.has(conversation.flowNodeId)) return false;

    const trimmed = visitorText.trim();
    if (trimmed.length > 254 || !EMAIL_PATTERN.test(trimmed)) return false;

    if (conversation.leadId) {
      await this.prisma.client.lead.update({ where: { id: conversation.leadId }, data: { email: trimmed } });
    }

    // Appointment has no createdAt column to filter "created in the last hour" by — the most
    // recently booked appointment for this conversation is, in practice, the pending one with the
    // latest startsAt (visitors don't rebook into an earlier slot after confirming a later one).
    const appointment = await this.prisma.client.appointment.findFirst({
      where: { conversationId, status: "pending" },
      orderBy: { startsAt: "desc" },
    });
    if (appointment) {
      await this.bookings.sendBookingEmails(appointment.id, { sendVisitorOnly: true }).catch(() => {});
    }

    return true;
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
