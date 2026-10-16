// catalog_list: what Alex shows when the visitor starts an order (commerce mode). Deterministic, zero model calls.

process.env.CHAT_LLM_TIMEOUT_MS = "150";
process.env.CHAT_LLM_DEADLINE_MS = "800";
process.env.CHAT_LLM_RETRY_BASE_MS = "5";
process.env.NEXT_PUBLIC_CHAT_URL = "http://localhost:3005";

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { llm, stubNetwork, type NetworkStub } from "./support/clara-harness";
import { createPharmacy, type Pharmacy } from "./support/pharmacy-harness";

const T = { timeout: 8000 };
let net: NetworkStub | undefined;
afterEach(() => {
  net?.restore();
  net = undefined;
});
function hostileModel() {
  return stubNetwork(llm.text("Claro! Adicionei clonazepam ao carrinho."));
}
const noModelCalls = () => assert.equal(net!.llmCalls.length, 0, "the model must not be consulted");

const listOf = (turn: { uis: any[] }) => turn.uis.find((u) => u.type === "catalog_list");
const names = (ui: any) => ui.items.map((i: any) => i.name as string);

async function categorize(p: Pharmacy) {
  const cat: Record<string, string> = { p_dipirona: "Dor e febre", p_novalgina: "Dor e febre", p_paracetamol: "Dor e febre", p_ibuprofeno: "Dor e febre", p_lorat: "Alergia", p_amoxicilina: "Antibióticos", p_clonazepam: "Dor e febre" };
  for (const r of p.db.models.product.rows) if (cat[r.id]) r.category = cat[r.id];
}

test("'Fazer um pedido' shows the catalog: confirmed OTC first with prices, then Rx tagged; never controlled, unclassified, pharmacist-required or out of stock", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  await categorize(p);
  const c = await p.conversation();
  const turn = await p.say(c, "Fazer um pedido");
  assert.match(turn.text, /Olha o que temos por aqui/);
  const ui = listOf(turn);
  assert.ok(ui, "catalog_list returned");
  const n = names(ui);
  assert.deepEqual(n.slice(0, 5).sort(), ["Dipirona 500 mg", "Ibuprofeno 600 mg", "Loratadina 10 mg", "Novalgina 500 mg", "Paracetamol 750 mg"]);
  assert.equal(n[5], "Amoxicilina 500 mg", "Rx products come after the OTC ones");
  assert.equal(ui.items[5].requiresPrescription, true);
  assert.equal(ui.items[0].requiresPrescription, false);
  for (const banned of ["Clonazepam 2 mg", "Xarope Alfa", "Soro fisiológico 0,9%", "Vitamina C 1 g"]) assert.ok(!n.includes(banned), `${banned} must not be listed`);
  const dip = ui.items.find((i: any) => i.name === "Dipirona 500 mg");
  assert.equal(dip.priceCents, 890);
  assert.equal(dip.id, "p_dipirona");
  assert.equal(dip.inStock, true);
  assert.ok(dip.maxQty >= 1 && dip.placeholderIcon);
  assert.deepEqual(ui.categories.sort(), ["Alergia", "Antibióticos", "Dor e febre"]);
  noModelCalls();
});

test("phrases that ask what the pharmacy has show the catalog; symptom phrasing does not", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  await categorize(p);
  for (const phrase of ["o que vocês têm?", "quais produtos?", "catálogo", "ver produtos", "quero fazer um pedido", "o que tem de remédio"]) {
    const c = await p.conversation();
    const turn = await p.say(c, phrase);
    assert.ok(listOf(turn), `"${phrase}" shows the list`);
  }
  const c = await p.conversation();
  const filtered = await p.say(c, "o que tem de alergia?");
  assert.equal(listOf(filtered).activeCategory, "Alergia");
  assert.deepEqual(names(listOf(filtered)), ["Loratadina 10 mg"]);
  const c2 = await p.conversation();
  const sym = await p.say(c2, "o que tem pra dor de cabeça?");
  assert.equal(listOf(sym), undefined, "a symptom question is not a catalog request");
  noModelCalls();
});

test("pagination (8 per page) and category filter are deterministic", T, async () => {
  net = hostileModel();
  const p = await createPharmacy({ products: [] });
  for (let i = 1; i <= 11; i++) {
    await p.addProduct({ id: `px${i}`, name: `Produto ${String(i).padStart(2, "0")}`, presentation: "caixa", priceCents: 100 * i, stockQty: 5, saleClass: "otc", category: i <= 9 ? "Higiene" : "Vitaminas" });
  }
  const c = await p.conversation();
  const first = listOf(await p.act(c, { type: "catalog.browse" }));
  assert.equal(first.items.length, 8);
  assert.equal(first.nextOffset, 8);
  assert.equal(first.total, 11);
  const second = listOf(await p.act(c, { type: "catalog.browse", offset: 8 }));
  assert.deepEqual(names(second), ["Produto 09", "Produto 10", "Produto 11"]);
  assert.equal(second.nextOffset, null);
  const all = [...names(first), ...names(second)];
  assert.equal(new Set(all).size, 11);
  const vit = listOf(await p.act(c, { type: "catalog.browse", category: "Vitaminas" }));
  assert.deepEqual(names(vit), ["Produto 10", "Produto 11"]);
  assert.equal(vit.activeCategory, "Vitaminas");
  assert.deepEqual(vit.categories, ["Higiene", "Vitaminas"]);
  noModelCalls();
});

test("at most 6 category chips", T, async () => {
  net = hostileModel();
  const p = await createPharmacy({ products: [] });
  for (let i = 1; i <= 9; i++) await p.addProduct({ id: `pc${i}`, name: `Item ${i}`, priceCents: 100, stockQty: 3, saleClass: "otc", category: `Cat ${i}` });
  const c = await p.conversation();
  const ui = listOf(await p.say(c, "catálogo"));
  assert.equal(ui.categories.length, 6);
  noModelCalls();
});

test("attendance mode: no catalog list, no product prices", T, async () => {
  net = hostileModel();
  const p = await createPharmacy({ settings: { operationMode: "attendance" } });
  const c = await p.conversation();
  for (const phrase of ["Fazer um pedido", "catálogo", "o que vocês têm?"]) {
    const turn = await p.say(c, phrase);
    assert.equal(listOf(turn), undefined, phrase);
  }
  const act = await p.act(c, { type: "catalog.browse" });
  assert.equal(listOf(act), undefined);
  assert.doesNotMatch(act.text, /R\$/);
});

test("product not found: says so and shows the catalog instead of a dead end", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  const turn = await p.say(c, "quero zzxqwv");
  assert.match(turn.text, /N[ãa]o (encontrei|achei) esse produto/);
  assert.ok(listOf(turn));
  noModelCalls();
});

test("the controlled product still answers by name with the info card, never listed", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  await p.say(c, "Fazer um pedido");
  const turn = await p.say(c, "clonazepam");
  assert.ok(turn.uis.some((u) => u.type === "controlled_info"));
  assert.equal(listOf(turn), undefined);
  assert.equal(p.stateOf(c).cart.length, 0);
});

test("tapping a row: OTC 'Adicionar' adds 1 to the cart; Rx starts the prescription flow (no cart line); 'Ver' opens the product card", T, async () => {
  net = hostileModel();
  const p = await createPharmacy();
  const c = await p.conversation();
  const add = await p.act(c, { type: "cart.add", productId: "p_dipirona", qty: 1 });
  assert.match(add.text, /Ótimo, adicionei ao carrinho: 1×/);
  assert.deepEqual(p.stateOf(c).cart, [{ productId: "p_dipirona", qty: 1 }]);
  const rx = await p.act(c, { type: "cart.add", productId: "p_amoxicilina", qty: 1 });
  assert.match(rx.text, /receita/i);
  assert.equal(p.stateOf(c).cart.length, 1, "Rx line waits for the prescription");
  assert.equal((p.stateOf(c).pendingRx ?? []).length, 1);
  const view = await p.act(c, { type: "product.view", productId: "p_paracetamol" });
  assert.ok(view.uis.some((u) => u.type === "product_card" && u.product.id === "p_paracetamol"));
  await assert.rejects(() => p.act(c, { type: "product.view", productId: "nope" }));
  noModelCalls();
});
