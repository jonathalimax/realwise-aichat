import test from "node:test";
import assert from "node:assert/strict";
import { chatBaseOrigin, chatLink, orderTrackingLink, legacyChatPathToNew } from "../src/common/chat-links";
import { isReservedSlug, slugProblem, assertValidSlug, RESERVED_SLUGS } from "../src/common/slug";
// @ts-expect-error plain .mjs without types
import { resolveRoute, DEFAULT_TARGETS } from "../../../scripts/dev-proxy.mjs";
// @ts-expect-error plain .mjs without types
import chatNextConfig from "../../chat/next.config.mjs";

const O = "https://aichat.realwise.com.br";

test("chatBaseOrigin: bare origin, legacy origin/client/conversation, trailing slashes, dev default", () => {
  assert.equal(chatBaseOrigin(O), O);
  assert.equal(chatBaseOrigin(`${O}/`), O);
  assert.equal(chatBaseOrigin(`${O}/client/conversation`), O);
  assert.equal(chatBaseOrigin(`${O}/client/conversation/`), O);
  assert.equal(chatBaseOrigin("http://localhost:3005/chat"), "http://localhost:3005");
  assert.equal(chatBaseOrigin(""), "http://localhost:3005");
  assert.equal(chatBaseOrigin("   "), "http://localhost:3005");
});

test("chatLink: /<slug>/chat with optional ?c=&t= (token only with a conversation)", () => {
  assert.equal(chatLink("farmacia-exemplo", { baseUrl: O }), `${O}/farmacia-exemplo/chat`);
  assert.equal(chatLink("farmacia-exemplo", { baseUrl: `${O}/client/conversation`, conversationId: "c1", resumeToken: "tok" }), `${O}/farmacia-exemplo/chat?c=c1&t=tok`);
  assert.equal(chatLink("x", { baseUrl: O, conversationId: "c1" }), `${O}/x/chat?c=c1`);
  assert.equal(chatLink("x", { baseUrl: O, resumeToken: "tok" }), `${O}/x/chat`);
  assert.equal(chatLink("x", { baseUrl: O, conversationId: "a b", resumeToken: "t&=" }), `${O}/x/chat?c=a%20b&t=t%26%3D`);
});

test("links with accents and uppercase slugs are percent-encoded, never altered", () => {
  assert.equal(chatLink("Farmácia-Boa", { baseUrl: O }), `${O}/Farm%C3%A1cia-Boa/chat`);
  assert.equal(orderTrackingLink("Farmácia-Boa", "abc_DEF-123", { baseUrl: O }), `${O}/Farm%C3%A1cia-Boa/pedido/abc_DEF-123`);
});

test("orderTrackingLink: /<slug>/pedido/<token>", () => {
  assert.equal(orderTrackingLink("farmacia-exemplo", "tok123", { baseUrl: `${O}/client/conversation` }), `${O}/farmacia-exemplo/pedido/tok123`);
});

test("uses NEXT_PUBLIC_CHAT_URL when no baseUrl is given", () => {
  const prev = process.env.NEXT_PUBLIC_CHAT_URL;
  process.env.NEXT_PUBLIC_CHAT_URL = `${O}/client/conversation`;
  try {
    assert.equal(chatLink("a-b", { conversationId: "c", resumeToken: "t" }), `${O}/a-b/chat?c=c&t=t`);
    assert.equal(orderTrackingLink("a-b", "tk"), `${O}/a-b/pedido/tk`);
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_CHAT_URL; else process.env.NEXT_PUBLIC_CHAT_URL = prev;
  }
});

test("legacy path mapping: /client/conversation/<slug> -> /<slug>/chat", () => {
  assert.equal(legacyChatPathToNew("/client/conversation/farmacia-exemplo"), "/farmacia-exemplo/chat");
  assert.equal(legacyChatPathToNew("/client/conversation/imob-x/"), "/imob-x/chat");
  assert.equal(legacyChatPathToNew("/client/conversation/pedido"), null);
  assert.equal(legacyChatPathToNew("/client/conversation/a/b"), null);
  assert.equal(legacyChatPathToNew("/farmacia-exemplo/chat"), null);
});

test("chat app next.config: assetPrefix /_c, no basePath, 308 redirects for the legacy links", async () => {
  assert.equal(chatNextConfig.assetPrefix, "/_c");
  assert.equal(chatNextConfig.basePath, undefined);
  const redirects: any[] = await chatNextConfig.redirects();
  assert.ok(redirects.every((r) => r.permanent === true), "permanent = 308");
  const slugRule = redirects.find((r) => r.source.startsWith("/client/conversation/:slug"));
  assert.equal(slugRule.destination, "/:slug/chat");
  // the pedido segment is never treated as a slug
  assert.match(slugRule.source, /\(\?!pedido\$\)/);
});

test("reserved slugs: routes of the shared domain cannot be taken (pt-BR error)", () => {
  for (const s of ["api", "admin", "client", "imobiliaria", "imobiliarias", "farmacia", "farmacias", "concessionaria", "concessionarias", "estetica", "app", "chat", "pedido", "login", "_c", "_next", "static", "assets", "favicon.ico", "robots.txt", "sitemap.xml", "sw.js", "health"]) {
    assert.ok(RESERVED_SLUGS.has(s), s);
    assert.ok(isReservedSlug(s), s);
  }
  assert.ok(isReservedSlug(" API "));
  assert.match(slugProblem("farmacia")!, /reservado/);
  assert.match(slugProblem("api")!, /reservado/);
  assert.throws(() => assertValidSlug("admin"), /reservado/);
});

test("slug format: lowercase letters, digits and hyphens only", () => {
  assert.equal(slugProblem("farmacia-exemplo"), null);
  assert.equal(slugProblem("farmacia-boa-saude-2"), null);
  assert.ok(slugProblem("Farmácia"));
  assert.ok(slugProblem("a b"));
  assert.ok(slugProblem("ab"));
  assert.ok(slugProblem("-abc"));
  assert.ok(slugProblem("abc--d"));
  assert.ok(slugProblem("abc/def"));
  assert.ok(slugProblem(""));
  assert.ok(slugProblem(undefined));
  assert.equal(assertValidSlug("  minha-loja "), "minha-loja");
});

test("dev proxy routing mirrors the production rules and priorities", () => {
  const r = (u: string) => resolveRoute(u, DEFAULT_TARGETS);
  assert.deepEqual([r("/api/health").name, r("/api/health").path], ["api", "/api/health"]);
  // /api/chat/... and /admin/chat must NOT be taken by the chat pattern
  assert.equal(r("/api/chat/biz/conversations").name, "api");
  assert.equal(r("/admin/chat").name, "admin");
  assert.equal(r("/farmacia/app/pedidos").name, "dashboard-farmacia");
  assert.equal(r("/imobiliaria/app/login").name, "dashboard-imobiliaria");
  assert.equal(r("/concessionaria/app").name, "dashboard-concessionaria");
  assert.equal(r("/farmacia-exemplo/chat").name, "chat");
  assert.equal(r("/farmacia-exemplo/chat?c=1&t=2").path, "/farmacia-exemplo/chat?c=1&t=2");
  assert.equal(r("/farmacia-exemplo/chat/sw.js").name, "chat");
  assert.equal(r("/farmacia-exemplo/pedido/tok").name, "chat");
  assert.equal(r("/client/conversation/farmacia-exemplo?c=1").name, "chat");
  const asset = r("/_c/_next/static/chunks/a.js?v=1");
  assert.deepEqual([asset.name, asset.path], ["chat", "/_next/static/chunks/a.js?v=1"]);
  assert.equal(r("/_c/clara-avatar.jpg").path, "/clara-avatar.jpg");
  assert.equal(r("/").name, "marketing");
  assert.equal(r("/farmacias").name, "marketing");
  assert.equal(r("/farmacia").name, "marketing");
  assert.equal(r("/_next/static/chunks/m.js").name, "marketing");
  assert.equal(r("/farmacia-exemplo").name, "marketing");
});
