# URL scheme and routing (one domain for every niche)

Domain: `https://aichat.realwise.com.br`. Path based, no per-niche hosts.

| Path | Served by |
| --- | --- |
| `/api/*` | API (Nest, global prefix `/api`; path is NOT stripped) |
| `/admin/*` | platform admin (basePath `/admin`) |
| `/imobiliaria/app/*` | dashboard container, `NEXT_PUBLIC_DEFAULT_NICHE=imobiliaria` |
| `/farmacia/app/*` | dashboard container, `farmacia` |
| `/concessionaria/app/*` | dashboard container, `concessionaria` |
| `/<client-slug>/chat` | customer chat (`?c=<conversationId>&t=<resumeToken>` resumes a conversation) |
| `/<client-slug>/chat/sw.js` | push service worker (`Service-Worker-Allowed: /<slug>/`, registered with scope `/<slug>/`) |
| `/<client-slug>/pedido/<token>` | order tracking page (token is the only credential; `noindex`) |
| `/_c/*` | chat app static files: `/_c/_next/static/...`, `/_c/clara-avatar.jpg`, `/_c/icon.svg` |
| `/client/conversation/<slug>[?c=&t=]` | legacy real-estate links: chat app answers **308** to `/<slug>/chat` (query kept) |
| everything else (`/`, `/farmacia`, `/farmacias`, `/_next/*`, ...) | marketing |

Priorities: api, admin and dashboards > chat > marketing (catch-all). `/api/chat/...` and `/admin/chat` must keep going to the API / admin, which is why the chat rule has a lower priority than those.

## Traefik rules for the infra agent

Replace the old `realwise-chat` rule (`PathPrefix(/client/conversation)`). Priorities are explicit (higher number wins):

```yaml
# API (existing; keep)                                      priority 300
- traefik.http.routers.realwise-api.rule=Host(`aichat.realwise.com.br`) && PathPrefix(`/api`)
- traefik.http.routers.realwise-api.priority=300
# admin (existing; keep)                                    priority 300
- traefik.http.routers.realwise-admin.rule=Host(`aichat.realwise.com.br`) && PathPrefix(`/admin`)
- traefik.http.routers.realwise-admin.priority=300
# dashboards, one router per niche container                priority 300
- traefik.http.routers.realwise-dash-imobiliaria.rule=Host(`aichat.realwise.com.br`) && PathPrefix(`/imobiliaria/app`)
- traefik.http.routers.realwise-dash-farmacia.rule=Host(`aichat.realwise.com.br`) && PathPrefix(`/farmacia/app`)
- traefik.http.routers.realwise-dash-concessionaria.rule=Host(`aichat.realwise.com.br`) && PathPrefix(`/concessionaria/app`)
# chat: customer pages + legacy redirects                   priority 200
- traefik.http.routers.realwise-chat.rule=Host(`aichat.realwise.com.br`) && (PathRegexp(`^/[^/]+/(chat|pedido)(/.*)?$`) || PathPrefix(`/client/conversation`))
- traefik.http.routers.realwise-chat.priority=200
# chat: static files. Strip /_c, the chat container then sees /_next/static/... and /clara-avatar.jpg   priority 200
- traefik.http.routers.realwise-chat-assets.rule=Host(`aichat.realwise.com.br`) && PathPrefix(`/_c`)
- traefik.http.routers.realwise-chat-assets.priority=200
- traefik.http.routers.realwise-chat-assets.middlewares=realwise-chat-strip
- traefik.http.middlewares.realwise-chat-strip.stripprefix.prefixes=/_c
# marketing: catch-all                                      priority 1
- traefik.http.routers.realwise-marketing.rule=Host(`aichat.realwise.com.br`)
- traefik.http.routers.realwise-marketing.priority=1
```

Syntax is Traefik v3 (`PathRegexp`). On v2 use the `{name:regex}` form instead: ``PathPrefix(`/{slug:[^/]+}/chat`) || PathPrefix(`/{slug:[^/]+}/pedido`)``. Verify the installed version. The chat app also answers `/_c/*` itself (rewrite), so the strip middleware is an optimisation, not a requirement.

Build/env notes:
- Chat image: no basePath any more, `assetPrefix=/_c` is fixed in `apps/chat/next.config.mjs`. `NEXT_PUBLIC_API_URL` (build arg) must be `https://aichat.realwise.com.br/api`.
- API env `NEXT_PUBLIC_CHAT_URL=https://aichat.realwise.com.br` (the legacy `https://aichat.realwise.com.br/client/conversation` is still accepted and normalised to the origin).
- Dashboard `NEXT_PUBLIC_CHAT_URL` build arg: same bare origin.

## Slugs are root-level, so some are reserved

`apps/api/src/common/slug.ts` (`RESERVED_SLUGS`, format `[a-z0-9]+(-[a-z0-9]+)*`, 3 to 60 chars) is enforced on `PATCH /businesses/me/slug` and `GET /businesses/slug-available/:slug` (reserved/invalid = not available), with pt-BR messages. Signup creates `pending-<ts>-<hash>` slugs, which the owner replaces in onboarding through that same endpoint.

Check production before deploying (existing real-estate slugs created before this rule):

```sql
SELECT id, slug, name, niche, status FROM "Business"
WHERE lower(slug) IN ('api','admin','client','clients','cliente','clientes','imobiliaria','imobiliarias','farmacia','farmacias',
  'concessionaria','concessionarias','estetica','esteticas','app','apps','chat','pedido','pedidos','login','logout','signup',
  'cadastro','entrar','dashboard','painel','_c','_next','static','assets','public','favicon.ico','robots.txt','sitemap.xml','sw.js',
  'manifest.json','health','healthz','status','www','mail','docs','blog','preco','precos','planos','contato','sobre','termos',
  'privacidade','demo','ajuda','suporte','webhook','webhooks','uploads','icon.svg');
```

or `tsx apps/api/scripts/check-reserved-slugs.ts` (read only, also reports invalid formats such as uppercase/accents; those still work as links because the slug is percent-encoded, only new edits are validated). A colliding business must be renamed (its old link then breaks) before the deploy. Local check: 1 business (`farmacia-exemplo`), no collision.

## Local routing simulator

`pnpm dev:proxy` (or `WITH_PROXY=1 scripts/dev-pharmacy.sh`) listens on `http://localhost:8080` with the same rules (`scripts/dev-proxy.mjs`, plain `node:http`, handles WebSocket upgrades for Next HMR). Targets (env or `--name=port`): `TARGET_API=3006`, `TARGET_ADMIN=3004`, `TARGET_DASH_FARMACIA=3003`, `TARGET_DASH_IMOBILIARIA=3008`, `TARGET_DASH_CONCESSIONARIA=3009`, `TARGET_CHAT=3005`, `TARGET_MARKETING=3007`. A target that is not running answers 502 naming it. The proxy only routes: links the API builds use `NEXT_PUBLIC_CHAT_URL`, so to see `http://localhost:8080/<slug>/pedido/<token>` in chat messages start the API with `NEXT_PUBLIC_CHAT_URL=http://localhost:8080` (with the default `.env` they point at `:3005`, which serves the same pages). For a faithful same-origin run also start the chat with `NEXT_PUBLIC_API_URL=http://localhost:8080/api`; with the default `:3006/api` the browser makes a cross-origin call, which the API allows for `:8080` in dev. Direct dev ports keep working: `http://localhost:3005/farmacia-exemplo/chat`. `PROXY_LOG=1` logs every routing decision. The routing function is unit tested (`apps/api/test/chat-links.test.ts`).

## Known gap

A service worker registered earlier under the old scope `/client/conversation/` (real-estate visitors who enabled push) keeps working until the browser drops it (its update URL now redirects); the next time the visitor enables notifications on the new URL a new subscription is made. Old `/pedido/<token>` links without slug (`/client/conversation/pedido/<token>`) were never shared outside local development and are not redirected.

> The authoritative rules are in `infra/docker/docker-compose.production.yml` (priorities api/admin/dashboards 300, chat 200, marketing 1) and are verified by `node scripts/check-routing.mjs`. This file mirrors them; if they differ, the compose file wins.
