// Deterministic scenario harness for Clara (chat + flow + owner assistant). Everything external is
// stubbed: Prisma is an in-memory fake, the inference gateway and the embedding server are reached
// through a stubbed global fetch, and the remaining Nest services are spies. Nothing here touches a
// real database, network, or model.

import { ChatService } from "../../src/modules/chat/chat.service";
import { FlowService } from "../../src/modules/chat/flow.service";
import { SimulatorService } from "../../src/modules/chat/simulator.service";
import { FinancingRatesService } from "../../src/modules/chat/financing-rates.service";
import { ListingsService } from "../../src/modules/listings/listings.service";
import { TeamSummaryService } from "../../src/modules/leads/team-summary.service";
import { OwnerAssistantService } from "../../src/modules/owner-assistant/owner-assistant.service";
import { PharmacyChatService } from "../../src/modules/chat/pharmacy/pharmacy-chat.service";
import { AlertsPharmacyNotifier, PrismaPharmacyHandoffs, PrismaPharmacyOrders } from "../../src/modules/chat/pharmacy/ports";
import { CustomerProfileService } from "../../src/modules/customers/customer-profile.service";
import { FallbackCepLookup, type CepLookup, type CepResult } from "../../src/modules/customers/cep-lookup";
import { ChatHumanService } from "../../src/modules/chat/chat-human.service";

type Row = Record<string, any>;

// ---------------------------------------------------------------------------------------------
// In-memory Prisma
// ---------------------------------------------------------------------------------------------

function norm(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function matchesValue(actual: any, condition: any): boolean {
  if (condition === undefined) return true;
  if (condition === null) return actual === null || actual === undefined;
  if (condition instanceof Date) return actual instanceof Date && actual.getTime() === condition.getTime();
  if (typeof condition !== "object" || Array.isArray(condition)) return actual === condition;
  // Prisma.DbNull / JsonNull sentinels are objects too.
  if (condition.constructor && condition.constructor.name && /Null$/.test(condition.constructor.name)) {
    return actual === null || actual === undefined;
  }
  for (const [op, value] of Object.entries(condition)) {
    if (op === "mode") continue;
    switch (op) {
      case "equals":
        if (condition.mode === "insensitive" ? norm(actual) !== norm(value) : actual !== value) return false;
        break;
      case "not":
        if (matchesValue(actual, value)) return false;
        break;
      case "in":
        if (!(value as any[]).includes(actual)) return false;
        break;
      case "notIn":
        if ((value as any[]).includes(actual)) return false;
        break;
      case "gte":
        if (actual === null || actual === undefined || actual < (value as any)) return false;
        break;
      case "gt":
        if (actual === null || actual === undefined || actual <= (value as any)) return false;
        break;
      case "lte":
        if (actual === null || actual === undefined || actual > (value as any)) return false;
        break;
      case "lt":
        if (actual === null || actual === undefined || actual >= (value as any)) return false;
        break;
      case "contains":
        if (typeof actual !== "string") return false;
        if (condition.mode === "insensitive" ? !norm(actual).includes(norm(value)) : !actual.includes(value as string)) return false;
        break;
      case "isEmpty":
        if (!Array.isArray(actual) || (actual.length === 0) !== value) return false;
        break;
      case "has":
        if (!Array.isArray(actual) || !actual.includes(value)) return false;
        break;
      default:
        // Unknown operator: permissive (the harness only needs the shapes the services use).
        break;
    }
  }
  return true;
}

function matchesWhere(row: Row, where: any): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (key === "AND") {
      if (!(condition as any[]).every((c) => matchesWhere(row, c))) return false;
    } else if (key === "OR") {
      if (!(condition as any[]).some((c) => matchesWhere(row, c))) return false;
    } else if (key === "NOT") {
      const list = Array.isArray(condition) ? condition : [condition];
      if (list.some((c) => matchesWhere(row, c))) return false;
    } else if (!(key in row) && key.includes("_") && condition && typeof condition === "object" && !Array.isArray(condition) && !(condition instanceof Date)) {
      // Prisma compound unique selector (e.g. businessId_phoneNormalized: { businessId, phoneNormalized }).
      if (!matchesWhere(row, condition)) return false;
    } else if (!matchesValue(row[key], condition)) {
      return false;
    }
  }
  return true;
}

function applyData(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && "increment" in value) {
      row[key] = (row[key] ?? 0) + (value as any).increment;
    } else if (value !== undefined) {
      row[key] = value;
    }
  }
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const [key, dir] = Object.entries(spec)[0] as [string, any];
      if (typeof dir !== "string") continue;
      const av = a[key] instanceof Date ? a[key].getTime() : a[key];
      const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
      if (av === bv) continue;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      return (av < bv ? -1 : 1) * (dir === "desc" ? -1 : 1);
    }
    return 0;
  });
}

let idCounter = 0;
let clock = Date.UTC(2026, 9, 12, 12, 0, 0);
function nextDate() {
  clock += 1000;
  return new Date(clock);
}

class FakeModel {
  rows: Row[] = [];
  calls: { op: string; args: any }[] = [];
  failOn: Partial<Record<string, Error>> = {};
  constructor(private readonly name: string, private readonly defaults: () => Row = () => ({})) {}

  private guard(op: string, args: any) {
    this.calls.push({ op, args });
    const failure = this.failOn[op];
    if (failure) throw failure;
  }

  async findUnique(args: any) {
    this.guard("findUnique", args);
    return this.rows.find((r) => matchesWhere(r, args?.where)) ?? null;
  }
  async findFirst(args: any) {
    this.guard("findFirst", args);
    return sortRows(this.rows.filter((r) => matchesWhere(r, args?.where)), args?.orderBy)[0] ?? null;
  }
  async findMany(args: any = {}) {
    this.guard("findMany", args);
    let rows = sortRows(this.rows.filter((r) => matchesWhere(r, args?.where)), args?.orderBy);
    if (args?.skip) rows = rows.slice(args.skip);
    if (args?.take !== undefined) rows = rows.slice(0, args.take);
    return rows;
  }
  async count(args: any = {}) {
    this.guard("count", args);
    return this.rows.filter((r) => matchesWhere(r, args?.where)).length;
  }
  async create(args: any) {
    this.guard("create", args);
    const createdAt = nextDate();
    const row: Row = { id: `${this.name}_${++idCounter}`, createdAt, ...this.defaults(), ...args.data };
    // Nested `{ create: [...] }` relations (e.g. Order.items) are stored as plain arrays.
    for (const [key, value] of Object.entries(row)) {
      if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && Array.isArray((value as any).create)) {
        row[key] = (value as any).create.map((v: Row) => ({ id: `${key}_${++idCounter}`, ...v }));
      }
    }
    this.rows.push(row);
    return row;
  }
  async update(args: any) {
    this.guard("update", args);
    const row = this.rows.find((r) => matchesWhere(r, args.where));
    if (!row) throw Object.assign(new Error(`${this.name} not found`), { code: "P2025" });
    applyData(row, args.data);
    return row;
  }
  async updateMany(args: any) {
    this.guard("updateMany", args);
    const rows = this.rows.filter((r) => matchesWhere(r, args.where));
    rows.forEach((r) => applyData(r, args.data));
    return { count: rows.length };
  }
  async upsert(args: any) {
    this.guard("upsert", args);
    const row = this.rows.find((r) => matchesWhere(r, args.where));
    if (row) {
      applyData(row, args.update);
      return row;
    }
    return this.create({ data: args.create });
  }
  async delete(args: any) {
    this.guard("delete", args);
    const index = this.rows.findIndex((r) => matchesWhere(r, args.where));
    return index >= 0 ? this.rows.splice(index, 1)[0] : null;
  }
  async groupBy(args: any) {
    this.guard("groupBy", args);
    const key = args.by[0];
    const counts = new Map<any, number>();
    for (const row of this.rows.filter((r) => matchesWhere(r, args.where))) {
      counts.set(row[key], (counts.get(row[key]) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, args.take ?? Infinity)
      .map(([value, count]) => ({ [key]: value, _count: { _all: count } }));
  }
}

export interface KbChunk {
  id?: string;
  businessId: string;
  content: string;
  // Cosine distance returned by the fake vector query (lower = closer).
  distance?: number;
}

export function createFakePrisma() {
  const models: Record<string, FakeModel> = {
    business: new FakeModel("business"),
    businessProfile: new FakeModel("businessProfile"),
    conversation: new FakeModel("conversation", () => ({
      status: "active",
      selectedListingIds: [],
      pinnedListingId: null,
      flowNodeId: null,
      flowParams: null,
      flowHistory: null,
      flowSnapshot: null,
      messageCount: 0,
      llmTurns: 0,
      leadId: null,
      engagementState: null,
      pinnedTransaction: null,
      pharmacyState: null,
    })),
    message: new FakeModel("message", () => ({ listingIds: [], answerSource: null, simulationData: null, retrievedChunkIds: [], kind: "standard", uiData: null })),
    pharmacySettings: new FakeModel("pharmacySettings", () => ({
      nextOrderNumber: 1001,
      nextRxNumber: 1,
      deliveryAreas: [],
      deliveryFeeCents: 0,
      minOrderCents: 0,
      pickupEnabled: true,
      deliveryEnabled: true,
      autoConfirmEnabled: true,
      stockMaxAgeHours: 24,
      openingHours: [],
      paymentMethods: ["pix", "cartao", "dinheiro"],
      quickChips: [],
    })),
    product: new FakeModel("product", () => ({ active: true, deletedAt: null, saleClass: "unclassified", classConfirmedAt: null, pharmacistRequired: false, maxQtyPerOrder: null, equivalentGroup: null, stockQty: null, stockAsOf: null, imageKey: null, presentation: null, manufacturer: null, activeIngredient: null })),
    pharmacistHandoff: new FakeModel("pharmacistHandoff", () => ({ status: "open", urgent: false, brief: {}, summary: "" })),
    order: new FakeModel("order", () => ({ status: "pending_pharmacist", items: [] })),
    orderStatusEvent: new FakeModel("orderStatusEvent"),
    prescriptionUpload: new FakeModel("prescriptionUpload"),
    consentRecord: new FakeModel("consentRecord"),
    customerAddress: new FakeModel("customerAddress", () => ({ isDefault: false, supersededAt: null, complement: null, reference: null })),
    listing: new FakeModel("listing", () => ({ status: "active", deletedAt: null, images: [] })),
    analyticsEvent: new FakeModel("analyticsEvent"),
    whatsappRoutingNumber: new FakeModel("whatsappRoutingNumber"),
    platformConfig: new FakeModel("platformConfig"),
    lead: new FakeModel("lead"),
    appointment: new FakeModel("appointment"),
    alert: new FakeModel("alert"),
  };

  const kb: KbChunk[] = [];
  const rawQueries: { sql: string; params: unknown[] }[] = [];
  const rawFailures: { vector?: Error; fullText?: Error } = {};

  const client: any = new Proxy(
    {
      // Interactive transactions run against the same in-memory client (no isolation needed here).
      $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(client),
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
        rawQueries.push({ sql, params });
        if (/UPDATE "PharmacySettings"/.test(sql)) {
          const settingsRow = models.pharmacySettings.rows.find((r) => r.businessId === params[0]);
          if (!settingsRow) return [];
          const n = settingsRow.nextOrderNumber;
          settingsRow.nextOrderNumber = n + 1;
          return [{ n }];
        }
        if (/SharedKnowledgeChunk/.test(sql)) return [];
        const businessId = params[0];
        const chunks = kb.filter((c) => c.businessId === businessId);
        if (/<=>/.test(sql)) {
          if (rawFailures.vector) throw rawFailures.vector;
          return chunks
            .filter((c) => c.distance !== undefined)
            .sort((a, b) => (a.distance! - b.distance!))
            .slice(0, Number(params[2] ?? 5))
            .map((c) => ({ id: c.id, content: c.content, distance: c.distance }));
        }
        if (rawFailures.fullText) throw rawFailures.fullText;
        // Full-text stand-in: a chunk matches when it contains EVERY (AND query) or ANY (" or "
        // query) of the query's significant words — accent-sensitive unless the SQL folds accents,
        // mirroring Postgres' to_tsvector('portuguese') which does not strip accents by itself.
        const query = String(params[1] ?? "");
        const foldsAccents = /translate\(/i.test(sql);
        const fold = (s: string) => (foldsAccents ? norm(s) : s.toLowerCase());
        const isOr = /\bor\b/.test(query);
        const terms = query
          .split(/\s+or\s+|\s+/i)
          .map((t) => fold(t.replace(/[^\p{L}\p{N}]/gu, "")))
          .filter((t) => t.length >= 4);
        if (terms.length === 0) return [];
        return chunks
          .filter((c) => {
            const content = fold(c.content);
            return isOr ? terms.some((t) => content.includes(t)) : terms.every((t) => content.includes(t));
          })
          .slice(0, Number(params[2] ?? 5))
          .map((c) => ({ id: c.id, content: c.content, rank: 0.1 }));
      },
    },
    {
      get(target: any, prop: string) {
        if (prop in target) return target[prop];
        if (!models[prop]) models[prop] = new FakeModel(prop);
        return models[prop];
      },
    },
  );

  return {
    prisma: { client } as any,
    models,
    kb,
    rawQueries,
    rawFailures,
    addChunk(chunk: KbChunk) {
      kb.push({ id: chunk.id ?? `chunk_${++idCounter}`, ...chunk });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Stubbed network: inference gateway + embeddings
// ---------------------------------------------------------------------------------------------

export interface GatewayRequestBody {
  purpose: string;
  businessId: string;
  systemPrompt: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export type LlmBehavior = (body: GatewayRequestBody, signal: AbortSignal | undefined, attempt: number) => Promise<Response> | Response;

export const llm = {
  text(text: string, model = "stub-model"): LlmBehavior {
    return () =>
      new Response(JSON.stringify({ text, provider: "managed", model, inputTokens: 10, outputTokens: 10, latencyMs: 5 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
  },
  status(code: number, body = "upstream failure"): LlmBehavior {
    return () => new Response(JSON.stringify({ error: body }), { status: code });
  },
  malformed(): LlmBehavior {
    return () => new Response("<html>Bad Gateway</html>", { status: 200, headers: { "content-type": "text/html" } });
  },
  // Never answers until the caller aborts — exercises client-side timeouts.
  hang(): LlmBehavior {
    return (_body, signal) =>
      new Promise<Response>((_resolve, reject) => {
        // AbortSignal.timeout() timers are unref'd; keep the test process alive while "hanging"
        // (a real server always has other handles open).
        const keepAlive = setInterval(() => {}, 1000);
        if (!signal) return; // no timeout on the caller side: hangs forever
        const abort = () => {
          clearInterval(keepAlive);
          reject(signal.reason ?? new Error("aborted"));
        };
        if (signal.aborted) return abort();
        signal.addEventListener("abort", abort);
      });
  },
  network(): LlmBehavior {
    return () => {
      throw new TypeError("fetch failed");
    };
  },
  sequence(...behaviors: LlmBehavior[]): LlmBehavior {
    return (body, signal, attempt) => behaviors[Math.min(attempt, behaviors.length - 1)](body, signal, attempt);
  },
  fn(handler: (body: GatewayRequestBody) => string): LlmBehavior {
    return (body, signal, attempt) => llm.text(handler(body))(body, signal, attempt);
  },
};

function toSse(response: Response): Promise<Response> {
  return (async () => {
    if (!response.ok) return response;
    let payload: any;
    try {
      payload = await response.clone().json();
    } catch {
      return new Response("event: error\ndata: {\"message\":\"inference_failed\"}\n\n", { status: 200 });
    }
    const body = `event: delta\ndata: ${JSON.stringify({ text: payload.text })}\n\nevent: done\ndata: ${JSON.stringify(payload)}\n\n`;
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  })();
}

export interface NetworkStub {
  llmCalls: GatewayRequestBody[];
  embeddingCalls: number;
  setLlm(behavior: LlmBehavior): void;
  setEmbedding(behavior: "ok" | "fail"): void;
  restore(): void;
}

export function stubNetwork(initial: LlmBehavior = llm.text("Olá!")): NetworkStub {
  const originalFetch = globalThis.fetch;
  let behavior = initial;
  let embedding: "ok" | "fail" = "ok";
  const stub: NetworkStub = {
    llmCalls: [],
    embeddingCalls: 0,
    setLlm(b) {
      behavior = b;
    },
    setEmbedding(b) {
      embedding = b;
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(typeof input === "string" ? input : input.url);
    if (url.includes("/api/embeddings")) {
      stub.embeddingCalls++;
      if (embedding === "fail") throw new TypeError("fetch failed (embedding server down)");
      return new Response(JSON.stringify({ embedding: [0.1, 0.2, 0.3] }), { status: 200 });
    }
    if (url.includes("/generate")) {
      const body = JSON.parse(init?.body ?? "{}") as GatewayRequestBody;
      const attempt = stub.llmCalls.length;
      stub.llmCalls.push(body);
      const response = await behavior(body, init?.signal, attempt);
      return url.includes("/generate/stream") ? toSse(response) : response;
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return stub;
}

// ---------------------------------------------------------------------------------------------
// Spies for the remaining services
// ---------------------------------------------------------------------------------------------

function spy<T extends Record<string, (...args: any[]) => any>>(impl: T) {
  const calls: Record<string, any[][]> = {};
  const wrapped: any = {};
  for (const [name, fn] of Object.entries(impl)) {
    calls[name] = [];
    wrapped[name] = (...args: any[]) => {
      calls[name].push(args);
      return fn(...args);
    };
  }
  return { service: wrapped as T, calls };
}

export interface ScenarioOptions {
  niche?: "imobiliaria" | "concessionaria" | "farmacia";
  profileSummary?: string;
  conversationalModeEnabled?: boolean;
  quota?: number;
  usedConversations?: number;
}

export function createClara(options: ScenarioOptions = {}) {
  const db = createFakePrisma();
  const businessId = "biz_1";
  db.models.business.rows.push({
    id: businessId,
    name: options.niche === "farmacia" ? "Farmácia Exemplo" : "Imobiliária Horizonte",
    slug: options.niche === "farmacia" ? "farmacia-exemplo" : "horizonte",
    niche: options.niche ?? "imobiliaria",
    email: "dono@example.com",
    timezone: "America/Sao_Paulo",
    conversationalModeEnabled: options.conversationalModeEnabled ?? false,
    cachedLocations: [],
  });
  db.models.businessProfile.rows.push({
    businessId,
    cachedSummary: options.profileSummary ?? "Imobiliária Horizonte — aluguel e venda de imóveis em Curitiba.",
    data: {},
    customInstructions: null,
  });
  db.models.platformConfig.rows.push({ id: "singleton" });

  const leads = spy({
    recomputeScoreForLead: async () => undefined,
    advanceStatus: async () => undefined,
    listForBusiness: async () => [] as any[],
    syncTeamSummary: async () => undefined,
  });
  const alerts = spy({ createAlert: async () => undefined });
  const usage = spy({
    countConversationsThisMonth: async () => options.usedConversations ?? 0,
    getConversationQuota: async () => options.quota ?? 0,
    // checkConversationQuota reads the plan (no plan -> entry plan quota), see PR #4.
    getSubscriptionPlan: async () => (options.quota ? { code: "essencial", conversationQuota: options.quota } : null),
  });
  const knowledge = spy({ recordUnanswered: async () => undefined });
  const analytics = spy({
    recordEvent: async (bId: string, name: string, props: unknown, conversationId?: string) => {
      db.models.analyticsEvent.rows.push({ businessId: bId, name, props, conversationId, occurredAt: new Date() });
    },
    dashboardSummary: async () => ({ conversations7d: 12, leadsTotal: 4, appointmentsTotal: 2, linkOpens7d: 30 }),
    timeseries: async () => [],
  });
  const calendar = spy({
    getAvailableSlots: async () => null as any,
    createEvent: async () => undefined,
  });
  const bookings = spy({
    createAppointmentAndNotify: async () => ({ id: "appt_1", notes: null }),
    sendBookingEmails: async () => undefined,
  });
  const availability = spy({
    configuredAppointmentTypes: async () => [] as string[],
    computeSlots: async () => [] as any[],
  });

  const listings = new ListingsService(db.prisma);
  const teamSummary = new TeamSummaryService(db.prisma, leads.service as any);
  const flow = new FlowService(
    db.prisma,
    leads.service as any,
    listings,
    bookings.service as any,
    availability.service as any,
    calendar.service as any,
    analytics.service as any,
    teamSummary,
  );
  const simulator = new SimulatorService(listings, new FinancingRatesService(db.prisma));

  // Pharmacy engine with every external piece stubbed: CEP provider, notifier alerts, in-memory DB.
  const cepBook = new Map<string, CepResult>();
  const cepControl = { mode: "ok" as "ok" | "fail" };
  const cepProvider: CepLookup = {
    name: "fake",
    async lookup(cep8: string) {
      if (cepControl.mode === "fail") throw new Error("cep provider down");
      return cepBook.get(cep8) ?? null;
    },
  };
  const customers = new CustomerProfileService(db.prisma, new FallbackCepLookup([cepProvider]));
  const pharmacy = new PharmacyChatService(
    db.prisma,
    customers,
    new PrismaPharmacyOrders(db.prisma),
    new PrismaPharmacyHandoffs(db.prisma),
    new AlertsPharmacyNotifier(alerts.service as any),
    analytics.service as any,
  );
  const human = new ChatHumanService(db.prisma);

  const chat = new ChatService(
    db.prisma,
    bookings.service as any,
    calendar.service as any,
    flow,
    leads.service as any,
    alerts.service as any,
    usage.service as any,
    knowledge.service as any,
    listings,
    analytics.service as any,
    simulator,
    teamSummary,
    availability.service as any,
    pharmacy,
  );
  const businesses = spy({ isSlugAvailable: async () => true });
  const owner = new OwnerAssistantService(db.prisma, analytics.service as any, leads.service as any, businesses.service as any);

  async function newConversation() {
    return chat.getOrCreateConversation(businessId, `visitor_${++idCounter}`);
  }

  function addListing(listing: Row) {
    const row = {
      id: listing.id ?? `listing_${++idCounter}`,
      businessId,
      status: "active",
      deletedAt: null,
      images: [],
      updatedAt: nextDate(),
      createdAt: nextDate(),
      referenceCode: null,
      transaction: null,
      listingType: null,
      priceCents: null,
      pricePeriod: null,
      priceText: null,
      bedrooms: null,
      parkingSpots: null,
      areaM2: null,
      neighborhood: null,
      city: null,
      description: null,
      url: null,
      ...listing,
    };
    db.models.listing.rows.push(row);
    return row;
  }

  // Sends one visitor turn through the real streaming path (what apps/chat uses) and returns
  // exactly what the visitor would have seen on the wire plus the final payload.
  async function stream(conversation: { id: string; visitorToken: string }, text: string) {
    const deltas: string[] = [];
    const result: any = await chat.streamMessage(businessId, conversation.id, text, conversation.visitorToken, (d) => deltas.push(d));
    return { shown: deltas.join(""), result };
  }

  async function send(conversation: { id: string; visitorToken: string }, text: string) {
    const result: any = await chat.sendMessage(businessId, conversation.id, text, conversation.visitorToken);
    return { shown: String(result?.message?.content ?? ""), result };
  }

  return {
    db,
    businessId,
    chat,
    flow,
    owner,
    listings,
    pharmacy,
    human,
    customers,
    cep: { book: cepBook, control: cepControl },
    spies: { leads, alerts, usage, knowledge, analytics, calendar, bookings, availability, businesses },
    newConversation,
    addListing,
    stream,
    send,
  };
}

// ---------------------------------------------------------------------------------------------
// Shared assertions
// ---------------------------------------------------------------------------------------------

const DEAD_END_PATTERNS = [/^\s*n[aã]o sei\.?\s*$/i, /^\s*n[aã]o tenho essa informa[cç][aã]o\.?\s*$/i];
const RAW_ERROR_PATTERNS = [/\bError\b/, /stack/i, /undefined/, /\bnull\b/, /stream_failed/, /Inference gateway/i, /\{[a-z_0-9]+\}/i, /<html/i];

// A reply is a dead end when it is empty, a bare "não sei", or has no forward path at all (no
// question back to the visitor, no offer of a next step).
export function deadEndReason(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "empty reply";
  if (DEAD_END_PATTERNS.some((p) => p.test(trimmed))) return "bare non-answer";
  const hasForwardPath =
    /\?/.test(trimmed) ||
    /\b(visita|agendar|whatsapp|time|equipe|atendente|corretor|vendedor|posso te ajudar|me conta|me diga|toque|escolha|painel)\b/i.test(trimmed);
  return hasForwardPath ? null : "no next step offered";
}

export function rawErrorLeak(text: string): string | null {
  const hit = RAW_ERROR_PATTERNS.find((p) => p.test(text));
  return hit ? `leaks ${hit}` : null;
}
