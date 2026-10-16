#!/usr/bin/env node
// Local routing simulator: reproduces the production Traefik rules (single domain, path based) on :8080.
// Plain node:http, no dependencies. See docs/pharmacy/URLS.md for the production rules this mirrors.
//
//   node scripts/dev-proxy.mjs                 (or: pnpm dev:proxy)
//   PROXY_PORT=8080 TARGET_API=3006 TARGET_ADMIN=3004 TARGET_DASH_FARMACIA=3003 \
//   TARGET_DASH_IMOBILIARIA=3008 TARGET_DASH_CONCESSIONARIA=3009 TARGET_CHAT=3005 TARGET_MARKETING=3007 node scripts/dev-proxy.mjs
//   (also accepts --port=8080 --chat=3005 --dash-concessionaria=3009 ... as arguments)
//
// Priority (highest first), same as the Traefik router priorities:
//   api / admin / dashboards  >  chat  >  marketing (catch-all)
// so `/api/chat/...` and `/admin/chat` still go to the API / admin, never to the chat app.
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? "1"]; }),
);
const pick = (arg, env, def) => Number(args[arg] ?? process.env[env] ?? def);

export const DEFAULT_TARGETS = {
  api: 3006,
  admin: 3004,
  dashImobiliaria: 3008,
  dashFarmacia: 3003,
  dashConcessionaria: 3009,
  chat: 3005,
  marketing: 3007,
};

export function targetsFromEnv() {
  return {
    api: pick("api", "TARGET_API", DEFAULT_TARGETS.api),
    admin: pick("admin", "TARGET_ADMIN", DEFAULT_TARGETS.admin),
    dashImobiliaria: pick("dash-imobiliaria", "TARGET_DASH_IMOBILIARIA", DEFAULT_TARGETS.dashImobiliaria),
    dashFarmacia: pick("dash-farmacia", "TARGET_DASH_FARMACIA", DEFAULT_TARGETS.dashFarmacia),
    dashConcessionaria: pick("dash-concessionaria", "TARGET_DASH_CONCESSIONARIA", DEFAULT_TARGETS.dashConcessionaria),
    chat: pick("chat", "TARGET_CHAT", DEFAULT_TARGETS.chat),
    marketing: pick("marketing", "TARGET_MARKETING", DEFAULT_TARGETS.marketing),
  };
}

const under = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

/** Returns { name, port, path } (path = what the upstream receives, query kept). Pure: unit tested. */
export function resolveRoute(url, targets = DEFAULT_TARGETS) {
  const q = url.indexOf("?");
  const path = q === -1 ? url : url.slice(0, q);
  const query = q === -1 ? "" : url.slice(q);
  const hit = (name, port, p = path) => ({ name, port, path: p + query });

  // 1. api / admin / dashboards
  if (under(path, "/api")) return hit("api", targets.api);
  if (under(path, "/admin")) return hit("admin", targets.admin);
  if (under(path, "/imobiliaria/app")) return hit("dashboard-imobiliaria", targets.dashImobiliaria);
  if (under(path, "/farmacia/app")) return hit("dashboard-farmacia", targets.dashFarmacia);
  if (under(path, "/concessionaria/app")) return hit("dashboard-concessionaria", targets.dashConcessionaria);
  // 2. chat: static files (prefix stripped), legacy links, /<slug>/chat and /<slug>/pedido/...
  if (under(path, "/_c")) return hit("chat", targets.chat, path.slice("/_c".length) || "/");
  if (under(path, "/client/conversation")) return hit("chat", targets.chat);
  if (/^\/[^/]+\/(chat|pedido)(\/.*)?$/.test(path)) return hit("chat", targets.chat);
  // 3. everything else
  return hit("marketing", targets.marketing);
}

export function startProxy(port = pick("port", "PROXY_PORT", 8080), targets = targetsFromEnv()) {
  const forwardHeaders = (req) => ({
    ...req.headers,
    "x-forwarded-for": req.socket.remoteAddress ?? "",
    "x-forwarded-host": req.headers.host ?? "",
    "x-forwarded-proto": "http",
  });

  const server = http.createServer((req, res) => {
    const route = resolveRoute(req.url ?? "/", targets);
    const up = http.request(
      { host: "127.0.0.1", port: route.port, method: req.method, path: route.path, headers: forwardHeaders(req) },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    up.on("error", (err) => {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(`dev-proxy: ${route.name} (:${route.port}) is not answering: ${err.code ?? err.message}\n${req.url}`);
    });
    req.pipe(up);
    if (process.env.PROXY_LOG === "1") console.log(`${req.method} ${req.url} -> ${route.name}:${route.port}${route.path}`);
  });

  // WebSocket upgrades (Next HMR), routed by the same rules.
  server.on("upgrade", (req, socket, head) => {
    const route = resolveRoute(req.url ?? "/", targets);
    const upstream = net.connect(route.port, "127.0.0.1", () => {
      const lines = [`${req.method} ${route.path} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head?.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });

  server.listen(port, () => {
    console.log(`dev-proxy on http://localhost:${port}`);
    for (const [k, v] of Object.entries(targets)) console.log(`  ${k.padEnd(20)} :${v}`);
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startProxy();
