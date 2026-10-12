import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SELECTED_LISTINGS,
  buildComparisonReply,
  buildCostPackage,
  buildCostPackageReply,
  extractFeeFromDescription,
  isCompareRequest,
  isCostPackageQuestion,
  isSimilarRequest,
  selectionEngagementReply,
  selectionPromptBlock,
  similarListingCriteria,
  toggleSelection,
  type SelectedListingDetails,
} from "../src/modules/chat/selection";

const OPTIONS = { itbiPercent: 3, notaryPercent: 1.5 };

const rental: SelectedListingDetails = {
  id: "l1",
  title: "Casa 3 quartos no Centro",
  transaction: "aluguel",
  priceCents: 250000,
  pricePeriod: "mês",
  bedrooms: 3,
  areaM2: 110,
  neighborhood: "Centro",
  description: "Casa ampla. Condomínio: R$ 450,00. IPTU R$ 1.200/ano.",
};

const sale: SelectedListingDetails = {
  id: "l2",
  title: "Apartamento 2 quartos Batel",
  transaction: "venda",
  priceCents: 50000000,
  bedrooms: 2,
  neighborhood: "Batel",
  description: "Condomínio fechado com 3 quartos de hóspedes.",
};

test("toggleSelection keeps most recent last, dedupes and caps", () => {
  assert.deepEqual(toggleSelection([], "a", true), ["a"]);
  assert.deepEqual(toggleSelection(["a", "b"], "a", true), ["b", "a"]);
  assert.deepEqual(toggleSelection(["a", "b"], "a", false), ["b"]);
  const many = Array.from({ length: MAX_SELECTED_LISTINGS }, (_, i) => `id${i}`);
  const next = toggleSelection(many, "new", true);
  assert.equal(next.length, MAX_SELECTED_LISTINGS);
  assert.equal(next[next.length - 1], "new");
  assert.ok(!next.includes("id0"));
});

test("extractFeeFromDescription requires an explicit R$ amount", () => {
  assert.deepEqual(extractFeeFromDescription(rental.description, "condominio"), { cents: 45000, annual: false });
  assert.deepEqual(extractFeeFromDescription(rental.description, "iptu"), { cents: 120000, annual: true });
  assert.equal(extractFeeFromDescription(sale.description, "condominio"), null);
  assert.equal(extractFeeFromDescription(null, "iptu"), null);
});

test("fees are never borrowed from another label or a non-amount", () => {
  assert.equal(extractFeeFromDescription("Condomínio isento. IPTU R$ 90", "condominio"), null);
  assert.deepEqual(extractFeeFromDescription("Condomínio isento. IPTU R$ 90", "iptu"), { cents: 9000, annual: false });
  assert.equal(extractFeeFromDescription("Cond.: consultar. IPTU R$ 120", "condominio"), null);
  assert.equal(extractFeeFromDescription("Condomínio incluso no aluguel R$ 2.000", "condominio"), null);
  assert.equal(extractFeeFromDescription("Condomínio e IPTU R$ 500", "condominio"), null);
  const pkg = buildCostPackage({ ...rental, description: "Condomínio isento. IPTU R$ 90" }, OPTIONS);
  assert.equal(pkg.totalCents, 250000 + 9000);
  assert.deepEqual(pkg.missing, ["condomínio"]);
});

test("rental cost package sums rent + condo + monthly IPTU", () => {
  const pkg = buildCostPackage(rental, OPTIONS);
  assert.equal(pkg.kind, "rent");
  assert.equal(pkg.totalCents, 250000 + 45000 + 10000);
  assert.deepEqual(pkg.missing, []);
  assert.match(buildCostPackageReply([pkg]), /Total mensal: R\$ 3\.050/);
});

test("rental cost package never invents missing fees", () => {
  const pkg = buildCostPackage({ ...rental, description: "Sem detalhes." }, OPTIONS);
  assert.equal(pkg.totalCents, 250000);
  assert.deepEqual(pkg.missing, ["condomínio", "IPTU"]);
  const text = buildCostPackageReply([pkg]);
  assert.match(text, /Não informado no anúncio: condomínio, IPTU/);
  assert.match(text, /com os valores que tenho/);
});

test("sale cost package labels ITBI/cartório as estimates", () => {
  const pkg = buildCostPackage(sale, OPTIONS);
  assert.equal(pkg.kind, "sale");
  assert.equal(pkg.totalCents, 50000000 + 1500000 + 750000);
  assert.ok(pkg.lines.filter((l) => l.estimated).length === 2);
  assert.match(buildCostPackageReply([pkg]), /estimativas/);
});

test("missing price yields no total", () => {
  const pkg = buildCostPackage({ ...sale, priceCents: null }, OPTIONS);
  assert.equal(pkg.totalCents, null);
  assert.ok(pkg.missing.includes("valor de venda"));
});

test("intent detectors for cost / similar / compare questions", () => {
  assert.equal(isCostPackageQuestion("Qual o pacote total que eu pagaria?"), true);
  assert.equal(isCostPackageQuestion("quanto fica tudo por mês?"), true);
  assert.equal(isCostPackageQuestion("quanto fica a parcela do financiamento?"), false);
  assert.equal(isCostPackageQuestion("aceita pet?"), false);
  assert.equal(isCostPackageQuestion("qual o total de quartos?"), false);
  assert.equal(isSimilarRequest("Ver imóveis parecidos"), true);
  assert.equal(isCompareRequest("Comparar os selecionados"), true);
});

test("similarListingCriteria anchors on the most recent selection", () => {
  const criteria = similarListingCriteria([sale, rental]);
  assert.deepEqual(criteria, {
    transaction: "aluguel",
    bedroomsMin: 2,
    bedroomsMax: 4,
    priceMin: 187500,
    priceMax: 312500,
    excludeIds: ["l2", "l1"],
  });
});

test("selection engagement adapts to rent vs buy and multiple selections", () => {
  const rent = selectionEngagementReply(rental, 1, "imobiliaria");
  assert.ok(rent.suggestions.includes("Quanto fica o total por mês?"));
  assert.ok(rent.suggestions.includes("Agendar uma visita"));
  const buy = selectionEngagementReply(sale, 1, "imobiliaria");
  assert.ok(buy.suggestions.some((s) => s.startsWith("Simular financiamento de R$ 500.000")));
  const multi = selectionEngagementReply(rental, 2, "imobiliaria");
  assert.ok(multi.suggestions.includes("Comparar os selecionados"));
});

test("selection prompt block tells Clara not to resend the list", () => {
  const block = selectionPromptBlock([rental], [buildCostPackage(rental, OPTIONS)]);
  assert.match(block, /SELECIONOU/);
  assert.match(block, /NÃO mostre a lista de imóveis de novo/);
  assert.match(block, /Total mensal: R\$ 3\.050/);
  assert.equal(selectionPromptBlock([], []), "");
});

test("comparison lists each selected listing", () => {
  const text = buildComparisonReply([rental, sale], [buildCostPackage(rental, OPTIONS), buildCostPackage(sale, OPTIONS)]);
  assert.match(text, /Casa 3 quartos no Centro/);
  assert.match(text, /Apartamento 2 quartos Batel/);
});
