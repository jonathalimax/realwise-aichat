#!/usr/bin/env node
// Offline check of the production Traefik routing in infra/docker/docker-compose.production.yml.
// It parses the compose labels, evaluates each router rule with a tiny matcher (Host, PathPrefix, Path, PathRegexp,
// &&, ||, parentheses), applies Traefik's "highest priority wins" and the stripprefix middleware, and asserts that
// every sample URL lands on the intended service. Not a Traefik replacement: it only models what we use.
//   node scripts/check-routing.mjs
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
function loadYaml() {
  try {
    return require("js-yaml");
  } catch {
    const dir = join(root, "node_modules/.pnpm");
    const hit = readdirSync(dir).find((d) => d.startsWith("js-yaml@"));
    if (!hit) throw new Error("js-yaml not found (run pnpm install)");
    return require(join(dir, hit, "node_modules/js-yaml"));
  }
}
const yaml = loadYaml();
const HOST = "aichat.realwise.com.br";

// --- parse compose -> routers
const compose = yaml.load(readFileSync(join(root, "infra/docker/docker-compose.production.yml"), "utf8"));
const routers = {};
const middlewares = {};
for (const [svc, def] of Object.entries(compose.services)) {
  for (const raw of def.labels ?? []) {
    const m = /^traefik\.http\.(routers|middlewares)\.([^.]+)\.(.+?)=(.*)$/.exec(raw);
    if (!m) continue;
    // docker compose turns "$$" into a literal "$"
    const value = m[4].replace(/\$\$/g, "$");
    const bag = m[1] === "routers" ? routers : middlewares;
    (bag[m[2]] ??= { service: svc, props: {} }).props[m[3]] = value;
  }
}

// --- rule evaluator
function tokenize(rule) {
  const out = [];
  const re = /\s*(&&|\|\||\(|\)|!|[A-Za-z]+\((?:`[^`]*`(?:\s*,\s*)?)+\))/y;
  let pos = 0;
  while (pos < rule.length) {
    re.lastIndex = pos;
    const m = re.exec(rule);
    if (!m) throw new Error(`cannot parse rule near: ${rule.slice(pos)}`);
    out.push(m[1]);
    pos = re.lastIndex;
  }
  return out;
}
function matcher(call, ctx) {
  const m = /^([A-Za-z]+)\((.*)\)$/.exec(call);
  const args = [...m[2].matchAll(/`([^`]*)`/g)].map((x) => x[1]);
  switch (m[1]) {
    case "Host": return args.some((a) => a === ctx.host);
    case "PathPrefix": return args.some((a) => ctx.path.startsWith(a));
    case "Path": return args.some((a) => ctx.path === a);
    case "PathRegexp": return args.some((a) => new RegExp(a).test(ctx.path));
    default: throw new Error(`unsupported matcher ${m[1]}`);
  }
}
function evalRule(rule, ctx) {
  const t = tokenize(rule);
  let i = 0;
  const or = () => { let v = and(); while (t[i] === "||") { i++; const r = and(); v = v || r; } return v; };
  const and = () => { let v = not(); while (t[i] === "&&") { i++; const r = not(); v = v && r; } return v; };
  const not = () => (t[i] === "!" ? (i++, !not()) : atom());
  const atom = () => {
    if (t[i] === "(") { i++; const v = or(); if (t[i++] !== ")") throw new Error("missing )"); return v; }
    return matcher(t[i++], ctx);
  };
  const v = or();
  if (i !== t.length) throw new Error(`trailing tokens in rule: ${rule}`);
  return v;
}

// Traefik default priority is the rule length; we require every https router to set it explicitly.
function route(url) {
  const u = new URL(url);
  const scheme = u.protocol === "https:" ? "https" : "http";
  const ctx = { host: u.hostname, path: u.pathname };
  const hits = Object.entries(routers)
    .filter(([, r]) => r.props.rule && (r.props.entrypoints ?? "").split(",").includes(scheme) && evalRule(r.props.rule, ctx))
    .map(([name, r]) => ({ name, service: r.service, priority: r.props.priority !== undefined ? Number(r.props.priority) : r.props.rule.length, r }));
  hits.sort((a, b) => b.priority - a.priority);
  if (hits.length > 1 && hits[0].priority === hits[1].priority) {
    return { ambiguous: hits.map((h) => h.name) };
  }
  const win = hits[0];
  if (!win) return null;
  let path = ctx.path;
  for (const mw of (win.r.props.middlewares ?? "").split(",").filter(Boolean)) {
    const prefixes = middlewares[mw]?.props["stripprefix.prefixes"];
    if (prefixes) for (const p of prefixes.split(",")) if (path.startsWith(p)) path = path.slice(p.length) || "/";
  }
  return { router: win.name, service: win.service, path, shadowed: hits.slice(1).map((h) => h.name), redirect: win.r.props.middlewares?.includes("redirect") };
}

// --- table of expectations: [url, service, path the container sees (optional)]
const B = `https://${HOST}`;
const table = [
  [`${B}/`, "marketing"],
  [`${B}/imobiliaria`, "marketing"],
  [`${B}/farmacia`, "marketing"],
  [`${B}/concessionaria`, "marketing"],
  [`${B}/concessionarias`, "marketing"],
  [`${B}/privacidade`, "marketing"],
  [`${B}/_next/static/chunks/main.js`, "marketing"],
  [`${B}/imobiliaria/app/login`, "dashboard"],
  [`${B}/imobiliaria/app/_next/static/x.js`, "dashboard"],
  [`${B}/imobiliaria/app/leads`, "dashboard"],
  [`${B}/farmacia/app/login`, "dashboard-farmacia"],
  [`${B}/farmacia/app/pedidos`, "dashboard-farmacia"],
  [`${B}/farmacia/app/catalogo/importar`, "dashboard-farmacia"],
  [`${B}/concessionaria/app/login`, "dashboard-concessionaria"],
  [`${B}/concessionaria/app/convite/abc`, "dashboard-concessionaria"],
  [`${B}/api/health`, "api"],
  [`${B}/api/chat/farmacia-exemplo/messages`, "api"], // also matches the chat regex: priority must send it to the API
  [`${B}/api/businesses/me`, "api"],
  [`${B}/api/pedido/abc`, "api"], // same shadow risk with "pedido"
  [`${B}/admin`, "admin"],
  [`${B}/admin/businesses`, "admin"],
  [`${B}/admin/chat/x`, "admin"],
  [`${B}/farmacia-exemplo/chat`, "chat", "/farmacia-exemplo/chat"],
  [`${B}/farmacia-exemplo/chat/`, "chat"],
  [`${B}/imob-centro/chat`, "chat"],
  [`${B}/auto-sul/chat/qualquer/coisa`, "chat"],
  [`${B}/farmacia-exemplo/pedido/TOKEN123`, "chat"],
  [`${B}/farmacia-exemplo/pedido`, "chat"],
  [`${B}/client/conversation/farmacia-exemplo`, "chat", "/client/conversation/farmacia-exemplo"],
  [`${B}/_c/_next/static/chunks/app.js`, "chat", "/_next/static/chunks/app.js"],
  [`${B}/_c/sw.js`, "chat", "/sw.js"],
  [`${B}/farmacia-exemplo`, "marketing"], // a bare slug is NOT a chat URL
  [`${B}/farmacia-exemplo/outra`, "marketing"],
  [`${B}/a/b/chat`, "marketing"], // chat must be the second segment
  [`http://${HOST}/farmacia-exemplo/chat`, "marketing"], // HTTP entrypoint: only the redirect router
  [`http://${HOST}/api/health`, "marketing"],
];

let failed = 0;
// every https router must set an explicit priority
for (const [name, r] of Object.entries(routers)) {
  if (r.props.rule && (r.props.entrypoints ?? "").split(",").includes("https") && r.props.priority === undefined) {
    console.error(`FAIL router ${name} has no explicit priority`);
    failed++;
  }
}
for (const [url, expectService, expectPath] of table) {
  const r = route(url);
  const got = r?.ambiguous ? `AMBIGUOUS(${r.ambiguous.join(",")})` : r?.service ?? "none";
  const pathOk = !expectPath || r?.path === expectPath;
  const ok = got === expectService && pathOk;
  if (!ok) failed++;
  const note = r?.shadowed?.length ? `  (also matched: ${r.shadowed.join(", ")})` : "";
  console.log(`${ok ? "ok  " : "FAIL"} ${url.replace(/^https?:\/\/[^/]+/, (m) => (m.startsWith("http:") ? "http:" : ""))} -> ${got}${r?.path && r.path !== new URL(url).pathname ? ` [path ${r.path}]` : ""}${note}${ok ? "" : `   expected ${expectService}${expectPath ? ` ${expectPath}` : ""}`}`);
}
console.log(failed ? `\n${failed} routing check(s) FAILED` : `\nall ${table.length} routing checks passed (${Object.keys(routers).length} routers)`);
process.exit(failed ? 1 : 0);
