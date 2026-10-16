// Pharmacy scenario harness: wraps the Clara harness (in-memory Prisma, stubbed gateway) with a
// pharmacy business, catalog helpers and conversation drivers. Deterministic: the model is a stub
// and every deterministic flow is asserted to run with ZERO model calls.

import assert from "node:assert/strict";
import { createClara, type ScenarioOptions } from "./clara-harness";
import { fold } from "../../src/modules/chat/pharmacy/text";

type Row = Record<string, any>;

export const PRODUCTS = {
  dipirona: { id: "p_dipirona", name: "Dipirona 500 mg", presentation: "10 comprimidos", manufacturer: "EMS", activeIngredient: "dipirona", priceCents: 890, stockQty: 42, saleClass: "otc", maxQtyPerOrder: 5, equivalentGroup: "grupo A" },
  novalgina: { id: "p_novalgina", name: "Novalgina 500 mg", presentation: "10 comprimidos", manufacturer: "Sanofi", activeIngredient: "dipirona", priceCents: 1290, stockQty: 18, saleClass: "otc", maxQtyPerOrder: 5, equivalentGroup: "grupo A" },
  paracetamol: { id: "p_paracetamol", name: "Paracetamol 750 mg", presentation: "20 comprimidos", manufacturer: "Medley", activeIngredient: "paracetamol", priceCents: 1120, stockQty: 30, saleClass: "otc", maxQtyPerOrder: 5 },
  ibuprofeno: { id: "p_ibuprofeno", name: "Ibuprofeno 600 mg", presentation: "10 comprimidos", manufacturer: "Eurofarma", activeIngredient: "ibuprofeno", priceCents: 1560, stockQty: 12, saleClass: "otc", maxQtyPerOrder: 5 },
  soro: { id: "p_soro", name: "Soro fisiológico 0,9%", presentation: "frasco 500 ml", manufacturer: "Fresenius", activeIngredient: "cloreto de sodio", priceCents: 650, stockQty: 0, saleClass: "otc" },
  amoxicilina: { id: "p_amoxicilina", name: "Amoxicilina 500 mg", presentation: "21 cápsulas", manufacturer: "EMS", activeIngredient: "amoxicilina", priceCents: 3290, stockQty: 9, saleClass: "prescription" },
  clonazepam: { id: "p_clonazepam", name: "Clonazepam 2 mg", presentation: "30 comprimidos", manufacturer: "Roche", activeIngredient: "clonazepam", priceCents: 2490, stockQty: 10, saleClass: "controlled" },
  xarope: { id: "p_xarope", name: "Xarope Alfa", presentation: "frasco 120 ml", manufacturer: "Lab Alfa", activeIngredient: null, priceCents: 1500, stockQty: 7, saleClass: "unclassified" },
  vitaminaC: { id: "p_vitc", name: "Vitamina C 1 g", presentation: "30 comprimidos efervescentes", manufacturer: "Cimed", activeIngredient: "acido ascorbico", priceCents: 1890, stockQty: 20, saleClass: "otc", pharmacistRequired: true },
  loratadina: { id: "p_lorat", name: "Loratadina 10 mg", presentation: "12 comprimidos", manufacturer: "Medley", activeIngredient: "loratadina", priceCents: 990, stockQty: 25, saleClass: "otc", maxQtyPerOrder: 3 },
} as const satisfies Record<string, Row>;

export interface PharmacyOptions extends Omit<ScenarioOptions, "niche"> {
  settings?: Row;
  /** Plan of the business' subscription (default "profissional" = commerce allowed). null = no subscription (trial = entry tier). */
  plan?: "essencial" | "profissional" | "studio" | null;
  /** Catalog keys (of PRODUCTS) to seed; default: all. */
  products?: (keyof typeof PRODUCTS)[];
}

export const CEP_RUA = { cep: "80250000", street: "Rua das Flores", district: "Água Verde", city: "Curitiba", state: "PR", provider: "viacep" as const };

export async function createPharmacy(options: PharmacyOptions = {}) {
  const clara = createClara({ ...options, niche: "farmacia" });
  const { db, businessId } = clara;
  await db.models.pharmacySettings.create({
    data: { businessId, deliveryFeeCents: 600, minOrderCents: 0, stockMaxAgeHours: 24, operationMode: "commerce", ...options.settings },
  });
  const planCode = options.plan === undefined ? "profissional" : options.plan;
  if (planCode) await db.models.subscription.create({ data: { businessId, plan: { code: planCode } } });
  clara.cep.book.set(CEP_RUA.cep, { ...CEP_RUA });
  clara.cep.book.set("80010000", { cep: "80010000", street: "", district: "Centro", city: "Curitiba", state: "PR", provider: "viacep" });

  async function addProduct(key: keyof typeof PRODUCTS | Row, patch: Row = {}) {
    const base: Row = typeof key === "string" ? PRODUCTS[key] : key;
    const row: Row = {
      businessId,
      stockAsOf: new Date(),
      // The pharmacist confirmed every seeded class unless the scenario says otherwise.
      classConfirmedAt: base.saleClass === "unclassified" ? null : new Date(),
      updatedAt: new Date(),
      ...base,
      ...patch,
    };
    return db.models.product.create({ data: row });
  }
  for (const key of options.products ?? (Object.keys(PRODUCTS) as (keyof typeof PRODUCTS)[])) await addProduct(key);

  async function setSettings(patch: Row) {
    await db.models.pharmacySettings.updateMany({ where: { businessId }, data: patch });
  }

  /** Plan change (upgrade/downgrade); null removes the subscription. */
  async function setPlan(code: "essencial" | "profissional" | "studio" | null) {
    db.models.subscription.rows.splice(0, db.models.subscription.rows.length);
    if (code) await db.models.subscription.create({ data: { businessId, plan: { code } } });
  }

  const conversation = () => clara.newConversation();

  /** One visitor text turn; returns everything the visitor saw. */
  async function say(conv: { id: string; visitorToken: string }, text: string, opts: { allowDegraded?: boolean } = {}) {
    const result: any = await clara.chat.sendMessage(clara.businessId, conv.id, text, conv.visitorToken);
    const turn = summarize(result);
    // A degraded reply means the engine threw (the chat service swallows it into a friendly message): fail loudly.
    if (!opts.allowDegraded) assert.ok(!/Tive uma instabilidade/.test(turn.text), `engine failed on "${text}": ${turn.text}`);
    return turn;
  }

  function summarize(result: any) {
    const messages: Row[] = result.messages ?? (result.message ? [result.message] : []);
    return {
      result,
      messages,
      texts: messages.map((m) => String(m.content ?? "")),
      text: messages.map((m) => String(m.content ?? "")).join("\n"),
      uis: messages.map((m) => m.ui ?? m.uiData ?? null).filter(Boolean) as Row[],
      suggestions: (result.suggestions ?? []) as string[],
      pharmacy: result.pharmacy,
    };
  }

  async function act(conv: { id: string; visitorToken: string }, action: Row) {
    const result = await clara.pharmacy.handleAction(clara.businessId, conv.id, action as any);
    const messages = result.messages as Row[];
    return {
      result,
      messages,
      texts: messages.map((m) => String(m.content ?? "")),
      text: messages.map((m) => String(m.content ?? "")).join("\n"),
      uis: messages.map((m) => m.ui ?? null).filter(Boolean) as Row[],
      suggestions: (result.suggestions ?? []) as string[],
      pharmacy: result.pharmacy,
    };
  }

  const stateOf = (conv: { id: string }) => db.models.conversation.rows.find((c) => c.id === conv.id)!.pharmacyState as Row;
  const orders = () => db.models.order.rows;
  const handoffs = () => db.models.pharmacistHandoff.rows;
  const assistantTexts = (conv: { id: string }) =>
    db.models.message.rows.filter((m) => m.conversationId === conv.id && m.role === "assistant").map((m) => String(m.content));
  const allMessages = (conv: { id: string }) => db.models.message.rows.filter((m) => m.conversationId === conv.id);

  /** Drives a delivery checkout from a non-empty cart up to the review card. Returns the last turn. */
  async function toReview(conv: { id: string; visitorToken: string }, opts: { phone?: string; name?: string; email?: string; number?: string; fulfillment?: "entrega" | "retirada" } = {}) {
    const phone = opts.phone ?? "(41) 99812-3344";
    await say(conv, "finalizar pedido");
    await say(conv, phone);
    const st = stateOf(conv);
    if (st.awaiting?.kind === "name") await say(conv, opts.name ?? "João Silva");
    if (stateOf(conv).awaiting?.kind === "email") await say(conv, opts.email ?? "joao@email.com");
    if (stateOf(conv).awaiting?.kind === "contact_consent") await say(conv, "Concordo");
    let turn = await say(conv, opts.fulfillment ?? "entrega");
    if (stateOf(conv).awaiting?.kind === "saved_address") return turn;
    if ((opts.fulfillment ?? "entrega") === "entrega") {
      if (stateOf(conv).awaiting?.kind === "cep") turn = await say(conv, "80250-000");
      if (stateOf(conv).awaiting?.kind === "number") turn = await say(conv, opts.number ?? "120B");
      if (stateOf(conv).awaiting?.kind === "complement") turn = await say(conv, "ap 31");
      if (stateOf(conv).awaiting?.kind === "reference") turn = await say(conv, "portão azul");
    }
    return turn;
  }

  return { ...clara, addProduct, setSettings, setPlan, conversation, say, act, summarize, stateOf, orders, handoffs, assistantTexts, allMessages, toReview };
}

export type Pharmacy = Awaited<ReturnType<typeof createPharmacy>>;

// ---------------------------------------------------------------------------------------------
// Shared assertions
// ---------------------------------------------------------------------------------------------

const DOSE_RE = /\b\d+\s?(?:mg|mcg|ml|gotas?|comprimidos?|c[aá]psulas?)\b|\b(?:de|a cada)\s+\d+\s*(?:em\s*\d+\s*)?horas?\b|\bposologia\b|\bdose\b/i;

/** The customer-visible lane E text carries no product name (catalog) and no dose. */
export function assertNoProductOrDose(pharmacy: Pharmacy, texts: string[], label: string) {
  const terms = new Set<string>();
  for (const p of pharmacy.db.models.product.rows) {
    terms.add(fold(String(p.name).split(" ")[0]));
    if (p.activeIngredient) fold(String(p.activeIngredient)).split(" ").forEach((w) => w.length >= 5 && terms.add(w));
  }
  for (const text of texts) {
    const f = fold(text);
    for (const term of terms) {
      assert.ok(!new RegExp(`(^|\\s)${term}(\\s|$)`).test(f), `${label}: product term "${term}" in customer text: "${text}"`);
    }
    assert.ok(!DOSE_RE.test(text), `${label}: dose-like text in customer message: "${text}"`);
  }
}

/** Nothing the pharmacist brief holds may appear in any customer-visible Message (content or ui). */
export function assertBriefNeverInMessages(pharmacy: Pharmacy, conv: { id: string }) {
  const handoffs = pharmacy.handoffs();
  const visible = pharmacy.allMessages(conv).map((m) => `${m.content} ${JSON.stringify(m.uiData ?? {})}`).join("\n");
  const foldedVisible = fold(visible);
  assert.ok(!/sugestao para o farmaceutico/.test(foldedVisible), "brief label leaked into a message");
  for (const h of handoffs) {
    const brief = (h.brief ?? {}) as Row;
    for (const s of (brief.suggestedProducts ?? []) as Row[]) {
      assert.ok(!foldedVisible.includes(fold(String(s.name))), `suggested product "${s.name}" leaked into a message`);
    }
    for (const field of ["allergies", "otherMedicines", "alreadyTried"]) {
      for (const item of (brief[field] ?? []) as string[]) {
        // Only items the visitor typed in this lane; they may legitimately echo in the VISITOR message, not in assistant ones.
        const assistant = pharmacy.allMessages(conv).filter((m) => m.role === "assistant").map((m) => `${m.content} ${JSON.stringify(m.uiData ?? {})}`).join("\n");
        assert.ok(!fold(assistant).includes(fold(item)) || fold(item).length < 4, `brief item "${item}" echoed into an assistant message`);
      }
    }
  }
}
