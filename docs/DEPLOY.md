# Production deploy (aichat.realwise.com.br)

One domain, nine containers, one Traefik. Deploy = push to `main` (`.github/workflows/deploy.yml`): build images -> `prisma migrate deploy` over SSH -> Coolify redeploys the stack from `infra/docker/docker-compose.production.yml`.

Check the routing table offline at any time: `node scripts/check-routing.mjs` (parses the compose labels, evaluates every Traefik rule against 36 sample URLs, fails if an URL lands on the wrong service or a router has no explicit priority).

## 1. URL map

| URL | Service (container) | Notes |
| --- | --- | --- |
| `/` and every other path (`/imobiliaria`, `/farmacia`, `/concessionaria`, `/privacidade`...) | `marketing` | priority 1 (catch-all) |
| `/imobiliaria/app/*` | `dashboard` | real estate dashboard (image `realwise-dashboard`, kept stable) |
| `/farmacia/app/*` | `dashboard-farmacia` | pharmacy dashboard |
| `/concessionaria/app/*` | `dashboard-concessionaria` | dealership dashboard (NEW; dealerships used `/imobiliaria/app` until now) |
| `/api/*` | `api` | includes `/api/chat/...` (priority 300 beats the chat router) |
| `/admin/*` | `admin` | |
| `/<client-slug>/chat[/...]` | `chat` | customer chat, same for all niches |
| `/<client-slug>/pedido/<token>` | `chat` | pharmacy order tracking page |
| `/client/conversation/<slug>` | `chat` | legacy link, the chat app redirects to `/<slug>/chat` |
| `/_c/*` | `chat` (prefix `/_c` stripped) | chat static assets (`assetPrefix`) |
| `http://` anything | redirect to https | `realwise-marketing-http` router |

Router priorities (explicit, so nothing shadows anything): api 300, admin 300, three dashboards 300, chat pages 200, chat assets 200, marketing 1. Because client slugs live at the root of the domain, the API refuses reserved slugs (`apps/api/src/common/slug.ts`: `api`, `admin`, `client`, `imobiliaria`, `farmacia`, `concessionaria`, `_c`, ...). A client slug can never collide with a route.

Which dashboard a person sees: the one under their niche's prefix. A member who signs in at another prefix (e.g. a pharmacy member at `/imobiliaria/app/login`) is sent to their own (`/farmacia/app/...`) right after login, and a signed-in member opening the wrong prefix is redirected too. Email links (invite, password reset, pharmacy notifications) are built with the member's own prefix (`dashboardBasePath(niche)` in `@realwise/shared`).

## 2. What changed in the pipeline (for this release)

- `deploy.yml` builds the dashboard three times (same code, different build args `NEXT_PUBLIC_DEFAULT_NICHE` + `NEXT_PUBLIC_BASE_PATH`; Next.js `basePath` is fixed at build time): `realwise-dashboard` (real estate, also tagged `realwise-dashboard-imobiliaria`), `realwise-dashboard-farmacia`, `realwise-dashboard-concessionaria`.
- Build arg `NEXT_PUBLIC_CHAT_URL` is now the bare origin `https://aichat.realwise.com.br`; `NEXT_PUBLIC_DASHBOARD_URL` is the bare origin too.
- The compose file has two new services: `dashboard-farmacia`, `dashboard-concessionaria`, with healthchecks and Traefik labels.
- `migrate` and `deploy` jobs are unchanged.

## 3. Steps, in order

### 3.1 GitHub (repo `jonathalimax/realwise-aichat`)

Already present, nothing to do: secrets `GHCR_PAT`, `VPS_SSH_PRIVATE_KEY`, `VPS_HOST`, `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`; variable `COOLIFY_STACK_UUID`.

New GitHub settings: **none**. (The 9 images are created in GHCR by the first run; the PAT already has `write:packages`.)

After the first successful run, in GitHub > your profile > Packages, make sure the two new packages (`realwise-dashboard-farmacia`, `realwise-dashboard-concessionaria`) are readable by the VPS: if the existing `realwise-*` packages are private and the VPS logs in to GHCR, the new ones inherit the same repo access (Package settings > "Manage Actions access" shows the repo; "Inherit access from source repository" should be on). If a pull fails with `denied`, this is why.

### 3.2 Coolify (the single Docker Compose resource of the stack)

1. Open the stack resource (the one whose UUID is `COOLIFY_STACK_UUID`) > **General**. The compose file is `infra/docker/docker-compose.production.yml`; if Coolify keeps its own copy, paste the new file contents there (or use "Reload compose file" if it follows the repo).
2. **Environment Variables**. Coolify shares them across services of the stack; the table in section 4 says which service reads which. Add the NEW ones listed there (section 4, column "New?").
3. **Domains**: do not set any domain per service in Coolify. Routing comes from the Traefik labels in the compose file; adding a domain in the UI would inject extra routers.
4. Do not click Deploy yet: merge to `main` first (section 3.5), the workflow triggers the guarded deploy.

### 3.3 DNS

Nothing new. `aichat.realwise.com.br` already points at the VPS and the Let's Encrypt certificate covers it (path routing needs no new hostname).

### 3.4 Database and storage (before the first deploy that contains the pharmacy)

- **Migrations**: the `migrate` job runs `prisma migrate deploy` before the deploy job, using the running api container's `DATABASE_URL`. This release adds the pharmacy migrations (team/access, pharmacy niche, orders, prescriptions, handoffs, knowledge...: everything under `packages/db/prisma/migrations` newer than the last one applied in production). They are additive; one of them rewrites existing `Role` permission JSON for the team/access feature. **Take a Postgres backup first** (`pg_dump` on the VPS, or the Coolify/provider snapshot) and write down the name of the last migration currently applied (`select migration_name from _prisma_migrations order by finished_at desc limit 1;`).
- **Private volume for prescriptions**: compose already mounts the named volume `realwise_storage` at `/data/realwise-storage` in `api` AND `worker`. Set `LOCAL_STORAGE_DIR=/data/realwise-storage` for both (section 4). Prescription photos/PDFs are saved there and ONLY served by the authenticated API route (`GET /api/prescriptions/:id/file`, `Cache-Control: private, no-store`); no proxy, no static path, no public URL points at this directory. Do not mount it into `marketing`, `chat` or the dashboards.
- **Backup of the volume**: the volume holds health-related files (prescriptions) and uploaded knowledge documents. Back it up daily to somewhere outside the VPS, encrypted, e.g. a cron on the VPS:
  `docker run --rm -v <project>_realwise_storage:/data:ro -v /root/backups:/out alpine tar czf /out/realwise-storage-$(date +%F).tgz -C /data .` then copy off the VPS (rclone to object storage with server-side encryption) and keep 14 to 30 days. Backups must respect the retention window: a purged prescription file must not live forever in an old backup (keep backups no longer than the shortest retention you promise, default 30 days; see `docs/pharmacy/DEPLOY_CHECKLIST.md`). Find the real volume name with `docker volume ls | grep realwise_storage`. Test a restore once.
- **Writable by the app user**: after the first deploy confirm the api container can write there (smoke test 6.7).

### 3.5 Merge and watch

1. Merge the PR to `main`. Watch GitHub > Actions > Deploy: 9 build jobs (api, worker, inference-gateway, chat, admin, marketing, dashboard x3), then migrate, then deploy.
2. If `migrate` fails, the deploy job does not run and production keeps the old version (see section 7 for rollback).
3. After the deploy job, run the smoke tests (section 6).

## 4. Environment variables (Coolify), per service

"New?" = not needed before this release / pharmacy. Values are never committed; set them in Coolify. Existing ones stay as they are.

| Variable | Used by | New? | Value / note |
| --- | --- | --- | --- |
| `DATABASE_URL`, `REDIS_URL` | api, worker | no | unchanged |
| `INFERENCE_GATEWAY_TOKEN` | api, worker, inference-gateway | no | the worker uses it to call the api's internal pharmacy jobs; keep identical in api and worker |
| `NEXT_PUBLIC_API_URL` | worker (internal api base), api | no | the worker must reach the api, e.g. `http://api:3006/api` (as today) |
| `DASHBOARD_URL` | api | check | bare origin `https://aichat.realwise.com.br`. Invite, reset and pharmacy notification links append `/<niche>/app/...` themselves. See "Known gap" below |
| `NEXT_PUBLIC_CHAT_URL` | api (CORS origin, chat links) | check | `https://aichat.realwise.com.br` (bare origin; the legacy `.../client/conversation` still works) |
| `NEXT_PUBLIC_DASHBOARD_URL`, `NEXT_PUBLIC_ADMIN_URL`, `NEXT_PUBLIC_MARKETING_URL` | api (CORS) | no | origins, same host |
| `CORS_ALLOWED_ORIGINS` | api | check | `https://aichat.realwise.com.br` (comma separated; one origin is enough because all apps share the host). The three dashboards, chat and admin are same-origin to the api (`/api`), but keep this set |
| `LOCAL_STORAGE_DIR` | api, worker | **yes** | `/data/realwise-storage` (the mounted private volume) |
| `RESEND_API_KEY` | api | **check** | required for pharmacy: invite emails, password reset, "order waiting" and stale-sheet alerts. Without it emails are skipped silently (only logged) |
| `TRANSACTIONAL_FROM_EMAIL` | api | optional | default `Realwise <avisos@realwise.com.br>`; the sender domain must be verified in Resend (SPF/DKIM) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | api | **yes** | web push for the pharmacy chat/alerts. Generate once: `npx web-push generate-vapid-keys`. `VAPID_SUBJECT` = `mailto:contato@realwise.com.br` (a real, monitored contact). Without them push is a no-op |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | api | no | unchanged |
| `STRIPE_PRICE_ESSENCIAL`, `STRIPE_PRICE_PROFISSIONAL`, `STRIPE_PRICE_STUDIO` | api | check | the pharmacy uses the same plan catalogue (`packages/shared/src/plans.ts`; plan features decide commerce vs attendance mode). Only change them if the pharmacy plans have different Stripe prices: create the prices in Stripe (monthly, BRL) and put the `price_...` ids here |
| `MANAGED_API_URL`, `MANAGED_API_KEY`, `MANAGED_MODEL`, `MANAGED_MODEL_CHAT`, `MANAGED_MODEL_ECONOMY`, `MANAGED_MODEL_LISTING_EXTRACTION` | api, worker | no | model provider as today. The pharmacy chat uses `MANAGED_MODEL_CHAT` for free-text turns and the economy model for catalog import mapping; if you set none of the optional ones the defaults apply |
| `EMBEDDING_MODEL`, `OLLAMA_URL` | worker, api | no | embeddings for the knowledge base (compose already has `ollama-embeddings`). The pharmacy knowledge base falls back to keyword search if embeddings are unavailable |
| `CATALOG_IMPORT_INLINE`, `CATALOG_IMPORT_FALLBACK_SECONDS` | api | optional | leave unset in production (queue-based import via the worker) |
| `NODE_ENV=production` | api | no | |

Build-time values (baked into the images by `deploy.yml`, not Coolify): `NEXT_PUBLIC_API_URL=https://aichat.realwise.com.br/api`, `NEXT_PUBLIC_CHAT_URL`, `NEXT_PUBLIC_DASHBOARD_URL`, Firebase keys (secrets), `NEXT_PUBLIC_DEFAULT_NICHE` and `NEXT_PUBLIC_BASE_PATH` (dashboard matrix).

**Known gap to resolve before relying on every email link**: several notification emails still build links as `dashboardLink("/inbox")`, `dashboardLink("/agenda")` (real estate / dealership), and Stripe return URLs and the Google Calendar callback append `/billing` / `/agenda` straight to `DASHBOARD_URL` (`flow.service.ts`, `chat.service.ts`, `booking-notifications.ts`, `billing.service.ts`, `calendar.controller.ts`). With `DASHBOARD_URL` as a bare origin those links miss the `/<niche>/app` prefix and would land on the marketing site; with the prefix included in `DASHBOARD_URL` they work but the invite/reset/pharmacy links (which add the prefix themselves) would double it. Whatever value production has today, check these two flows after deploy (smoke tests 6.9, 6.10); the clean fix is to pass the niche prefix at those call sites (`dashboardBasePath(niche)`) and keep `DASHBOARD_URL` as a bare origin.

## 4b. Creating customers from the admin console (no phone / SMS)

Admin console > Clientes > **Novo cliente**: choose the niche (farmácia, imobiliária, concessionária), business name, owner name and e-mail. The owner receives an e-mail (Resend) with a link to `/<niche>/app/convite/<token>` (valid 7 days) to choose a password, then lands in the onboarding interview. Needs `RESEND_API_KEY`; without it the admin screen shows the link to copy. For a business that already exists (signed up by phone), open it > **Enviar acesso por e-mail**: the owner gets a password-setup link and can then log in with e-mail and password. Migration `20261017100000_business_phone_optional` only drops NOT NULL on `Business.phone` (additive; the unique index stays).

## 5. First run: create the first pharmacy

1. Open `https://aichat.realwise.com.br/farmacia` (marketing page) and click **Entrar no painel** / pick a plan: it goes to `https://aichat.realwise.com.br/farmacia/app/login`.
2. Sign in with the owner's phone (Firebase SMS) or, for a pharmacy created by an admin, e-mail + password. A brand-new account opens the onboarding wizard: step 1 has the **niche picker** (Imobiliária / Concessionária / **Farmácia**). Choose Farmácia, name, owner, e-mail and the client slug (the chat will live at `https://aichat.realwise.com.br/<slug>/chat`). Because niche decides the dashboard prefix, picking a niche different from the prefix you logged in at moves you to that niche's dashboard (expected).
3. In the dashboard (`/farmacia/app`): Farmácia > fill hours, delivery area, fees, payment; set the operation mode (`commerce` needs a plan that includes it, otherwise `attendance`); add the Responsible Pharmacist (name + CRF) in Equipe e acessos; Base de conhecimento > add the store Q&As; Catálogo > Importar planilha (commerce only).
4. Publish; open `https://aichat.realwise.com.br/<slug>/chat` on a phone and place a test conversation. Delete or cancel the test data afterwards.
5. Dealerships: the same picker with Concessionária lands on `/concessionaria/app`. Existing dealership tenants keep working: their members are redirected from `/imobiliaria/app` to `/concessionaria/app` at login.

## 6. Smoke tests (after the deploy job is green)

Run from any machine. `B=https://aichat.realwise.com.br`.

```bash
B=https://aichat.realwise.com.br
# 6.1 marketing + niche landing pages
for p in / /farmacia /imobiliaria /concessionaria; do curl -s -o /dev/null -w "$p %{http_code}\n" $B$p; done          # all 200
# 6.2 http -> https redirect
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://aichat.realwise.com.br/farmacia                          # 301/308 to https
# 6.3 api (and that /api/chat is NOT swallowed by the chat router)
curl -s -w "\n%{http_code}\n" $B/api/health                                                                              # 200
curl -s -w "\n%{http_code}\n" "$B/api/chat/00000000-0000-0000-0000-000000000000/consent-text?purpose=pharmacy_triage"   # a JSON answer/error from the api, never an HTML page
# 6.4 the three dashboards answer on their own prefix
for p in imobiliaria farmacia concessionaria; do curl -s -o /dev/null -w "$p login %{http_code}\n" $B/$p/app/login; done # all 200
curl -s $B/farmacia/app/login | grep -o '/farmacia/app/_next' | head -1                                                # assets use the right prefix
curl -s $B/concessionaria/app/login | grep -o '/concessionaria/app/_next' | head -1
# 6.5 admin
curl -s -o /dev/null -w "%{http_code}\n" $B/admin                                                                        # 200 or a redirect to /admin/login
# 6.6 chat pages, assets and the legacy link
curl -s -o /dev/null -w "%{http_code}\n" $B/<slug>/chat                                                                  # 200
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $B/client/conversation/<slug>                                   # redirect to /<slug>/chat
curl -s $B/<slug>/chat | grep -o '/_c/_next/static[^"]*' | head -1 | sed "s#^#$B#" | xargs curl -s -o /dev/null -w "asset %{http_code}\n"   # 200
curl -s -o /dev/null -w "%{http_code}\n" $B/<slug>/pedido/invalid-token                                                  # 200/404 page of the chat app, not marketing
```

6.7 **Prescription storage** (as the demo/test pharmacy): upload a photo in the chat flow with a prescription product, then in `/farmacia/app/pedidos` open the receita. Then, on the VPS: `docker exec $(docker ps --format '{{.Names}}' | grep '^api-' | head -1) ls /data/realwise-storage` shows the file; and `curl -s -o /dev/null -w "%{http_code}\n" $B/<anything under that path>` is 404 (it is not served anywhere).
6.8 **Worker jobs**: `docker logs <worker container> --since 5m | grep pharmacy-job` shows `order-reminders` every minute (counts only, no health data), and the boot line lists `pharmacy-order-reminders, pharmacy-stale-sheet, pharmacy-retention-purge`.
6.9 **Email**: from `/farmacia/app/equipe` invite a test address; the invite link must start with `https://aichat.realwise.com.br/farmacia/app/convite/`. Repeat "Esqueci a senha" on `/concessionaria/app/login`: the link must be `/concessionaria/app/redefinir-senha?token=`.
6.10 **Wrong prefix**: sign in as a pharmacy member at `$B/imobiliaria/app/login`: you must end on `$B/farmacia/app/<home>`.
6.11 **Push**: in the pharmacy dashboard allow notifications, trigger a handoff from the chat and check the browser notification; `curl $B/api/chat/<businessId>/push/public-key` returns the public key when VAPID is set.

## 7. Rollback

- **Images are tagged** `:latest` and `:<git sha>` for every service. To roll back a service, in Coolify edit the compose image to `ghcr.io/jonathalimax/realwise-<name>:<previous sha>` and redeploy, or revert the commit on `main` (the pipeline rebuilds and redeploys).
- **Routing only** (e.g. a Traefik rule typo): fix the labels in the compose file in Coolify and redeploy; no image rebuild needed.
- **Dealerships** moved to `/concessionaria/app`. If that container misbehaves, remove the `dashboard-concessionaria` service; dealership members will be redirected to a dead prefix, so instead point them back temporarily by deploying the previous commit (their old link `/imobiliaria/app` keeps working there).
- **Database**: Prisma migrations here are additive, so the previous images keep working against the new schema. Do not "migrate down"; if data is damaged, restore the pre-deploy backup from step 3.4 (this loses data written after the backup).
- **Volume**: never delete `realwise_storage` on rollback; it holds prescriptions and uploaded documents.

## 8. What only the owner can do (exact clicks)

1. **Backup first**: on the VPS (or in your DB provider panel) take a Postgres snapshot, and note the last applied migration (section 3.4).
2. **Resend**: https://resend.com > Domains > Add domain `realwise.com.br` (if not yet verified) > add the DNS records it shows (SPF, DKIM) at your DNS provider > wait for "Verified". API Keys > Create API Key (Sending access) > copy it. Coolify > stack > Environment Variables > add `RESEND_API_KEY` = that key.
3. **VAPID keys**: on your laptop run `npx web-push generate-vapid-keys`. Coolify > Environment Variables > add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (api service) and `VAPID_SUBJECT` = `mailto:<a monitored e-mail>`. Never regenerate them later (it silently invalidates every existing push subscription).
4. **Storage volume**: Coolify > stack > Environment Variables > add `LOCAL_STORAGE_DIR` = `/data/realwise-storage`. Set up the daily volume backup (section 3.4) and run one restore test.
5. **Stripe**: only if pharmacy plans have different prices: Stripe Dashboard > Product catalogue > create the monthly BRL prices > copy each `price_...` > Coolify env `STRIPE_PRICE_ESSENCIAL` / `STRIPE_PRICE_PROFISSIONAL` / `STRIPE_PRICE_STUDIO`.
6. **Coolify**: stack resource > General > update the compose (section 3.2) > Environment Variables as above > Save. Leave "Domains" empty.
7. **GitHub**: Pull Request #8 > Merge (squash or merge commit). Actions tab > Deploy > watch until green (builds, migrate, deploy).
8. **GHCR access** if a pull fails: GitHub > Profile > Packages > `realwise-dashboard-farmacia` (and `-concessionaria`) > Package settings > Manage Actions access / "Inherit access from repository"; also confirm the VPS login to ghcr.io has `read:packages`.
9. **Run the smoke tests** (section 6), then create the first pharmacy (section 5).
10. **Legal**: complete `docs/pharmacy/DEPLOY_CHECKLIST.md` before the first real pharmacy sends real customers to the chat.
11. Pending from the existing workflow notes: rotate the broad classic `GHCR_PAT` for a fine-grained token (this repo only, Contents: Read + Packages: Read and write).
