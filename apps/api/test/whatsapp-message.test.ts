import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_WHATSAPP_MESSAGE_CHARS,
  buildWhatsappLinks,
  buildWhatsappMessage,
  firstNameOf,
  maskPhoneBr,
  whatsappDigits,
} from "../src/modules/handoffs/whatsapp-message";

const symptomBrief = {
  symptoms: "Dor de cabeça",
  duration: "1–3 dias",
  severity: "Forte",
  forWhom: { relation: "Para mim", age: "34 anos", pregnant: false, pregnancyAnswer: "Não" },
  allergies: ["dipirona"],
  otherMedicines: ["losartana"],
  alreadyTried: ["ibuprofeno sem melhora"],
  redFlags: ["Dor ou aperto no peito"],
  suggestedProducts: [{ productId: "p1", name: "Paracetamol 750 mg", reason: "Compatível", inStock: true, priceCents: 1120 }],
  suggestionNote: "Sugestão para o farmacêutico, não enviada ao cliente.",
  inProgress: { byName: "Paulo" },
  contact: { firstName: "Maria", phoneMasked: "(41) •••••-2233" },
  conversationLink: "/conversas?open=c1",
};

const base = { customerName: "maria clara souza", attendantName: "Paulo Nunes", attendantRole: "Farmacêutico RT", pharmacyName: "Farmácia Exemplo", reason: "symptom", brief: symptomBrief };

test("greeting uses the customer's first name, the attendant's name, role and the pharmacy", () => {
  const msg = buildWhatsappMessage(base);
  assert.ok(msg.startsWith("Olá, Maria! Aqui é Paulo Nunes, Farmacêutico RT da Farmácia Exemplo. Recebi seu atendimento pelo chat e já li o que você me contou:"));
  assert.ok(msg.endsWith("Posso te ajudar com isso?"));
  assert.ok(!/Souza|Clara/.test(msg), "only the first name of the customer");
});

test("summary repeats only what the customer said", () => {
  const msg = buildWhatsappMessage(base);
  for (const expected of ["Dor de cabeça (forte)", "1–3 dias", "Para mim, 34 anos", "dipirona", "losartana", "ibuprofeno sem melhora"]) assert.ok(msg.includes(expected), expected);
});

test("never leaks stock suggestions, internal flags, notes, markers, links or prices", () => {
  const msg = buildWhatsappMessage(base);
  for (const forbidden of ["Paracetamol", "R$", "11,20", "Sugestão", "não enviada", "Dor ou aperto", "alerta", "inProgress", "conversas?open", "(41)", "2233", "gestante", "Gestante", "grávida"]) {
    assert.ok(!msg.includes(forbidden), `leaked: ${forbidden}`);
  }
});

test("'no' answers are not repeated; empty summary degrades gracefully", () => {
  const msg = buildWhatsappMessage({ ...base, brief: { symptoms: "Tosse", allergies: ["Nenhuma"], otherMedicines: ["Nenhum"], alreadyTried: [] } });
  assert.ok(msg.includes("Tosse"));
  assert.ok(!/Alergias|Outros remédios|já tentou/.test(msg));
  const empty = buildWhatsappMessage({ ...base, brief: {}, customerName: null });
  assert.equal(empty, "Olá! Aqui é Paulo Nunes, Farmacêutico RT da Farmácia Exemplo. Recebi seu atendimento pelo chat.\n\nPosso te ajudar com isso?");
});

test("product requests carry only the requested item (no stock, price or equivalents)", () => {
  const msg = buildWhatsappMessage({
    ...base,
    reason: "out_of_stock",
    brief: { requestedProduct: "Rinosoro 30 ml", stock: 0, availability: "Sem estoque", equivalents: [{ productId: "x", name: "Soro Y", priceCents: 900 }], priceInformedCents: 2490, customerRequest: "Cliente pediu o produto e ele está sem estoque." },
  });
  assert.ok(msg.includes("Produto que você pediu: Rinosoro 30 ml"));
  for (const forbidden of ["Sem estoque", "Soro Y", "R$", "24,90", "Cliente pediu"]) assert.ok(!msg.includes(forbidden), forbidden);
});

test("a red-flag handoff repeats the customer's own words, not the flag label", () => {
  const msg = buildWhatsappMessage({ ...base, brief: { symptoms: "Dor ou aperto no peito", severity: "urgente", customerText: "meu pai está com dor no peito", redFlags: ["Dor ou aperto no peito"] } });
  assert.ok(!msg.includes("urgente"));
  assert.ok(msg.includes("O que você sente: Dor ou aperto no peito"), "the symptom wording stored from the customer's message");
});

test("truncates safely under the limit, keeping greeting and closing question", () => {
  const long = "muito ".repeat(300);
  const msg = buildWhatsappMessage({
    ...base,
    brief: { symptoms: long, duration: long, forWhom: { relation: long, age: long }, allergies: [long, long, long], otherMedicines: [long], alreadyTried: [long] },
  });
  assert.ok(msg.length <= MAX_WHATSAPP_MESSAGE_CHARS, `length ${msg.length}`);
  assert.ok(msg.startsWith("Olá, Maria!"));
  assert.ok(msg.endsWith("Posso te ajudar com isso?"));
  const huge = buildWhatsappMessage({ ...base, attendantName: "N".repeat(500), pharmacyName: "F".repeat(500), brief: { symptoms: long } });
  assert.ok(huge.length <= MAX_WHATSAPP_MESSAGE_CHARS);
});

test("control and invisible characters are stripped from customer text", () => {
  const msg = buildWhatsappMessage({ ...base, brief: { symptoms: "dor\u0000 de​\ncabeça forte" } });
  assert.ok(msg.includes("dor de cabeça forte"));
});

test("first name helper", () => {
  assert.equal(firstNameOf("  joão   da silva "), "João");
  assert.equal(firstNameOf(null), "");
  assert.equal(firstNameOf("1234"), "");
});

test("links: E.164 digits, web.whatsapp.com and wa.me with the encoded text", () => {
  const links = buildWhatsappLinks("+5541991112233", "Olá, Maria! Posso ajudar?\nSim & não")!;
  assert.equal(links.phoneDigits, "5541991112233");
  assert.equal(links.webUrl, "https://web.whatsapp.com/send?phone=5541991112233&text=Ol%C3%A1%2C%20Maria!%20Posso%20ajudar%3F%0ASim%20%26%20n%C3%A3o");
  assert.equal(links.appUrl, "https://wa.me/5541991112233?text=Ol%C3%A1%2C%20Maria!%20Posso%20ajudar%3F%0ASim%20%26%20n%C3%A3o");
  assert.equal(whatsappDigits("(41) 99111-2233"), "5541991112233");
  assert.equal(whatsappDigits("41 9111"), null);
  assert.equal(buildWhatsappLinks(null, "x"), null);
});

test("masked phone shows area code and last digits only", () => {
  assert.equal(maskPhoneBr("+5541991112233"), "(41) •••••-2233");
  assert.equal(maskPhoneBr("123"), null);
});


// ---------------------------------------------------------------- general_question + resume link
import { buildChatResumeLink, chatBaseUrl } from "../src/modules/handoffs/resume-link";

test("general_question message: greeting + the customer's question, no symptom wording", () => {
  const msg = buildWhatsappMessage({ customerName: "maria", attendantName: "Bruno", attendantRole: "Atendente", pharmacyName: "Farmácia X", reason: "general_question", brief: { question: "Vocês entregam no domingo?", symptoms: "dor" } });
  assert.match(msg, /^Olá, Maria! Aqui é Bruno, Atendente da Farmácia X\. Recebi sua pergunta pelo chat:/);
  assert.ok(msg.includes("Sua pergunta: Vocês entregam no domingo?"));
  assert.ok(!/sintoma|sente|dor/i.test(msg));
});

test("resume link is appended last, never truncated, and the whole text stays under the cap", () => {
  const link = buildChatResumeLink({ slug: "farmacia-x", conversationId: "c1", resumeToken: "tok", baseUrl: "http://localhost:3005" });
  assert.equal(link, "http://localhost:3005/client/conversation/farmacia-x?c=c1&t=tok");
  const long = "muito ".repeat(60);
  const msg = buildWhatsappMessage({
    customerName: "Maria", attendantName: "Paulo", attendantRole: "Farmacêutico", pharmacyName: "Farmácia X", reason: "symptom",
    brief: { symptoms: long, duration: long, allergies: [long], otherMedicines: [long], alreadyTried: [long] }, resumeLink: link,
  });
  assert.ok(msg.length <= MAX_WHATSAPP_MESSAGE_CHARS, String(msg.length));
  assert.ok(msg.endsWith(`Para continuar sua compra pelo chat: ${link}`));
  const noLink = buildWhatsappMessage({ attendantName: "P", attendantRole: "F", pharmacyName: "X" });
  assert.ok(!noLink.includes("Para continuar"));
});

test("chat base url: adds the basePath once, tolerates trailing slashes and an env that already has it", () => {
  assert.equal(chatBaseUrl("https://chat.x.com/"), "https://chat.x.com/client/conversation");
  assert.equal(chatBaseUrl("https://chat.x.com/client/conversation"), "https://chat.x.com/client/conversation");
  assert.equal(chatBaseUrl(""), "http://localhost:3005/client/conversation");
});
