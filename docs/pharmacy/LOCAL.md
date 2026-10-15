# Running the pharmacy system locally

Everything here is local only: local Postgres, local Redis, no deploy, no real e-mail, no language model required.

## 1. Prerequisites (one time)

- macOS with Homebrew, Node 20 (`/opt/homebrew/opt/node@20`), pnpm 9, Postgres 17 with `pgvector`, Redis.
- Postgres database `realwise` (user and password `realwise`, `localhost:5432`) and Redis on `localhost:6379`.
  They are not started at login. Start them with:

  ```
  brew services run postgresql@17 redis
  ```
  (`scripts/dev-pharmacy.sh` does this for you when they are down.)
- A git-ignored `.env` at the repo root with local values (it already exists on this machine). It needs at least
  `DATABASE_URL` (localhost), `SESSION_SECRET`, `INFERENCE_GATEWAY_TOKEN`, `LOCAL_STORAGE_DIR` (absolute path, `.local-storage` in the repo),
  `REDIS_URL`, `API_PORT=3006`, `NEXT_PUBLIC_API_URL=http://localhost:3006/api`, `NEXT_PUBLIC_CHAT_URL=http://localhost:3005/client/conversation`,
  `CORS_ALLOWED_ORIGINS`, and placeholder `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` (the API refuses to boot without them).
  Firebase is not configured, so phone login does not work locally: use e-mail + password.
- `pnpm install` done once.

## 2. Start everything

```
cd ~/Developer/Personal/realwise-aichat
scripts/dev-pharmacy.sh
```

It checks Postgres/Redis, refuses to run unless `DATABASE_URL` points to localhost, runs `prisma migrate deploy` (additive migrations only, never a reset),
seeds the demo pharmacy (idempotent, refreshes the stock sheet date so auto-confirmation works), then starts the API, worker, dashboard, chat widget and
marketing site and prints the URLs. Ctrl-C stops only what the script started (not Postgres/Redis). Logs: `.local-logs/<app>.log`.
The first load of each Next page compiles it (can take 10 to 30 s).

Operation mode of the demo (see `OPERATION_MODE.md`): it starts as `commerce` on the `profissional` plan. Flip it (applied on every run, no data is deleted):

```
DEMO_MODE=attendance scripts/dev-pharmacy.sh        # AI attendant only, no catalog/orders
DEMO_PLAN=essencial scripts/dev-pharmacy.sh         # plan without commerce: forced to attendance (banner + upgrade CTA)
DEMO_MODE=commerce DEMO_PLAN=profissional scripts/dev-pharmacy.sh   # back to the default
# or only the seed, with the stack already running:
cd apps/api && DEMO_MODE=attendance pnpm run seed:pharmacy     (or: pnpm run seed:pharmacy -- --mode=attendance --plan=essencial)
```

| Plan | Commerce allowed | Mode the demo runs in |
| --- | --- | --- |
| `essencial` (and trial / no subscription) | no | attendance (even if "commerce" is chosen) |
| `profissional`, `studio` | yes | the chosen one (`DEMO_MODE`, default commerce) |

You can also change it in the dashboard as the owner: Farmácia > Modo de operação (commerce is disabled on a plan without it).

Demo knowledge base: the seed (also after `--reset`) fills Base de conhecimento with 37 store Q&As (`apps/api/scripts/pharmacy-demo-kb.ts`, saved through the same service and guards as the dashboard, keyword search only without an embedder) and 3 short documents, and creates the business profile (interview answers) consistent with the settings. A re-run refreshes the 37 demo answers; `SEED_SYNC_PROFILE=1` also rewrites the profile. QA data is removed with `pnpm --filter @realwise/api exec tsx scripts/zz-qa-cleanup.ts --apply` (prefix `zz-qa`).

Options: `RESET_DEMO=1 scripts/dev-pharmacy.sh` recreates the demo pharmacy's data; `WITH_GATEWAY=1` also starts the inference gateway; `WITH_ADMIN=1` the platform admin app (:3004).

| What | URL |
| --- | --- |
| Dashboard | http://localhost:3003/farmacia/app/login |
| Chat widget (Alex) | http://localhost:3005/client/conversation/farmacia-exemplo |
| Landing page | http://localhost:3007/farmacia |
| API health | http://localhost:3006/api/health |

### Demo logins (password for all: `Farmacia@2026`)

| Role | E-mail | Notes |
| --- | --- | --- |
| Proprietário | dono@farmaciaexemplo.test | sees everything |
| Farmacêutico RT | farmaceutica@farmaciaexemplo.test | CRF-PR 12345: validates prescriptions, confirms classes, answers handoffs |
| Gerente | gerente@farmaciaexemplo.test | no class review, no prescription validation |
| Atendente | atendente@farmaciaexemplo.test | orders, customers, conversations; no handoffs, settings, team |
| Entregador | entregador@farmaciaexemplo.test | only their own deliveries (opens on Pedidos) |

Demo customers (phones to try "returning customer"): Maria Souza `(41) 99999-0001` (saved address in Água Verde), João `99999-0002`, Ana `99999-0003`, Carlos `99999-0004`, Beatriz `99999-0005` (address outside the delivery area).
The demo business: "Farmácia Exemplo", slug `farmacia-exemplo`, 41 products (OTC, prescription, controlled, 4 unclassified, 4 out of stock), orders PED-1001 to 1015 in every status, RX-1 to RX-3, five handoffs (one urgent), conversations including a "joined the conversation" banner, an access log, and three alerts. Delivery area: Centro, Batel, Água Verde, Bigorrilho, Portão. Fee R$ 6,00, minimum for delivery R$ 25,00.

## 3. Click-through test script

1. **Roles.** Log in as each role (use a private window per role). Check the sidebar: owner sees everything, pharmacist has no "Equipe" or "Plano", attendant has no "Atendimento", "Farmácia", "Catálogo > Revisar classes", courier only sees Pedidos with their own deliveries. Type a forbidden URL (for example `/equipe` as pharmacist): a "Você não tem acesso" page appears.
2. **Chat, OTC delivery.** Open the widget. "Fazer um pedido" > "quero 2 dipirona 500mg" > Finalizar > phone `(41) 99999-0001` (returning: greeted by name, masked address) > Entrega > "Está certo" > Confirmar. Order PED-10xx appears on the dashboard (Pedidos > Novos or Confirmados). It is auto-confirmed (fresh stock, address in area). Open the status link the chat gives you (branding colours apply).
3. **Chat, pickup.** New phone, name, skip e-mail, "Retirada em loja". No minimum applies to pickup.
4. **Chat, prescription.** "quero amoxicilina 500mg" > upload any image (consent box) > Finalizar > checkout. Order lands in Pedidos > Novos with a "Receita" tag; log in as the pharmacist, Pedidos > Receitas > open > Aprovar, then confirm the order. As gerente/atendente the approve action is refused.
5. **Controlled and unclassified.** "quero clonazepam 2mg", "tem melatonina?": information card only, never in a cart; "Falar com o farmacêutico" creates a handoff.
6. **Symptom.** "estou com dor de cabeça": consent, questionnaire, handoff. As the pharmacist: Atendimento farmacêutico > open > reply. In the widget (reload or wait for polling) the banner "Dra. Carla Menezes · Farmacêutico RT entrou na conversa" and the named reply appear.
7. **Red flag.** "meu filho de 3 meses está com febre alta" or "dor forte no peito": SAMU 192 card, urgent handoff (red badge, critical alert at the top of the dashboard). Buying is blocked for 30 minutes.
8. **Out of stock.** "quero novalgina" (stock 0): the equivalent Dipirona is offered; choosing it makes the order wait for the pharmacist and creates a swap handoff.
9. **Order lifecycle.** Pedidos: confirm, set courier (as gerente/dono), courier marks "saiu" and "entregue", cancel with a reason (reason required, "Outro motivo" needs a note). Log in as the courier: only their own orders; others return 403/404.
10. **Import.** Catálogo > Importar planilha. Upload `docs/pharmacy/sample-catalog/estoque-exemplo-A.xlsx` (title rows, EAN, tarja column, cost column) then `estoque-exemplo-B.csv` (semicolon CSV, SKU, no tarja). Check the mapping (without a model it is the header heuristic and every column is marked low confidence), confirm, set the stock date and tick the confirmation. Note the trap row "Clonazepam 0,5mg: Venda Livre": it is proposed as controlled anyway. Afterwards Catálogo > Revisar classes (pharmacist only): confirm groups, set unclassified items by hand.
11. **Team.** Equipe > Convidar: the invite link is shown on screen (and logged by the API) because no e-mail provider is configured. Open it in a private window, accept, log in. Roles tab: duplicate a role, edit the grid. "Registro de acessos" lists the actions above.
12. **Branding.** Farmácia > Aparência: change the three colours; dashboard, widget header and the order status page follow. Restore teal `#0F766E / #0B4F4A / #F59E0B` when done.
13. **Notifications and numbers.** Sidebar badges (Pedidos, Atendimento) update every 20 s; alerts strip on every page; Início KPIs (orders today, waiting, open handoffs, revenue of delivered orders).
14. **Retention purge** (internal job, normally daily at 03:30 by the worker): set `PrescriptionUpload.retentionDeleteAt` to the past in SQL, then
    `curl -X POST localhost:3006/api/internal/pharmacy/retention-purge -H "x-internal-token: $INFERENCE_GATEWAY_TOKEN"`. The file disappears, the download answers 410.

### 3.1 WhatsApp hand-over (Atendimento farmacêutico)

1. Log in as the pharmacist (`Dra. Carla`, see demo logins) at `/farmacia/app/atendimento`, open the "Dor de cabeça há 3 dias" handoff (the demo customers have phones).
2. Click **Iniciar atendimento**: a preview dialog shows the message ("Olá, Maria! Aqui é <seu nome>, <função> da <farmácia>. ... Posso te ajudar com isso?"). Edit it if you like and click **Abrir no WhatsApp Web** (new tab to `web.whatsapp.com/send?phone=...`; "Abrir no app" uses `wa.me`). The row now shows "Em atendimento · <nome>".
3. Click **Marcar como respondido**: the handoff moves to "Respondidos" and the customer's web chat shows "<Nome> · <Função> continuou o atendimento pelo WhatsApp".
4. In the chat widget, start a symptom ("estou com dor de cabeça"), answer the questions: before the handoff Alex asks "Qual seu WhatsApp (com DDD)..." (type a number, or "Prefiro continuar só pelo chat"). The new handoff then shows the contact in the dashboard.
5. The audit log (Equipe > Registro) lists `handoff.whatsapp_link`, `handoff.start`, `handoff.whatsapp_answer`. Details in `docs/pharmacy/WHATSAPP_HANDOFF.md`.

### Trying attendance mode (after `DEMO_MODE=attendance`)

1. Dashboard as the owner: the menu has no Pedidos or Catálogo, "Atendimento farmacêutico" comes first, Início shows open handoffs / answered today / average response / conversations. `/pedidos` shows the "modo atendimento" panel; the API answers 403 `MODE_ATTENDANCE` (or `PLAN_FEATURE` with `DEMO_PLAN=essencial`).
2. Widget: chips are "Falar com o farmacêutico", "Horários e entrega", "Perguntar sobre um produto". Type "tem dipirona 500mg? quanto custa?": Alex says he does not look up stock or price, asks to register the request, and "Sim, pode registrar" creates an Atendimento "Pedido de produto" for the pharmacist. "quero 2 dipirona" never reaches a cart. A red flag ("dor no peito") still gives SAMU 192 and an urgent handoff.
3. Farmácia > Modo de operação: switch back to commerce (plan permitting).

## 4. Reset local data

- Demo pharmacy only: `RESET_DEMO=1 scripts/dev-pharmacy.sh` or `pnpm --filter @realwise/api seed:pharmacy -- --reset` (deletes the demo business' own rows and recreates them).
- Uploaded files (prescriptions, product images, sheets) live in `.local-storage/` (git-ignored). Delete that folder together with a reset if you want a clean slate.
- Never run `prisma migrate reset`. The seed refuses to run against a non-local `DATABASE_URL`.
- Regenerate the sample sheets: `pnpm --filter @realwise/api sample:catalog`.

## 5. Plugging in a language model (optional)

Nothing needs a model. Without one, the chat's safety rules, cart, checkout, red flags, symptom questionnaire, hours/delivery answers and the catalog import (header heuristics, reference lists) run deterministically; free-form questions get a graceful "I do not have that confirmed, I asked the team" answer.

To add a model, set in the root `.env` and run the gateway (`WITH_GATEWAY=1 scripts/dev-pharmacy.sh`):

- Local Ollama: `OLLAMA_URL=http://localhost:11434`, `OLLAMA_MODEL=<model>`, `EMBEDDING_MODEL=<embedding model>`.
- Managed API: `MANAGED_API_URL`, `MANAGED_API_KEY`, `MANAGED_MODEL`.
- `INFERENCE_GATEWAY_URL=http://localhost:3002` and the shared `INFERENCE_GATEWAY_TOKEN` (already set).

With a model, imports also get column mapping and class proposals from the model (still confirmed by the pharmacist) and general questions are answered from the knowledge base. The model never decides safety or money.

## 6. Known limitations

- No model by default (see above). E-mails are only logged ("RESEND_API_KEY not set"); invite and reset links appear in the UI/API log.
- Phone (Firebase) login does not work locally; invites and e-mail/password do.
- `.xls` (old Excel) is refused on purpose: save as `.xlsx` or `.csv`.
- A sheet row without EAN whose name embeds the presentation (for example the CSV's "Dipirona Gotas 500mg/ml 20ml") is created as a new product instead of updating an existing one that has a different name/presentation split.
- A prescription photo uploaded and then abandoned (no order) stays in Pedidos > Receitas as pending until the retention purge removes it.
- New-order e-mails (logged only) also go to the courier role because it can see "Pedidos".
- The pharmacy is not required to be open for an order to be accepted (the review says it will be handled on opening).
- Dark mode is not styled for the pharmacy palette. Staff web push is not implemented (alerts, badges and e-mail only).
- The curated reference list of controlled/prescription substances is NOT legally reviewed; the pharmacist confirms every class.
- `next dev` shows a dev-tools bubble that overlaps the bottom-left corner of the pages; it does not exist in a production build.

## Plugging in the same model as real estate

The API talks to the inference gateway (`apps/inference-gateway`, port 3002), which uses either a managed API (OpenRouter by default) or Ollama. Fill these in the git-ignored root `.env` (same values your production uses; never commit them):

```
MANAGED_API_KEY=...            # the provider key
MANAGED_MODEL=...              # e.g. the same model id production uses
MANAGED_API_URL=...            # only if you do not use OpenRouter
INFERENCE_GATEWAY_URL=http://localhost:3002
INFERENCE_GATEWAY_TOKEN=...    # any shared secret, same value for API and gateway
```

`scripts/dev-pharmacy.sh` then starts the gateway automatically (or force it with `WITH_GATEWAY=1`). For Ollama set `OLLAMA_URL` / `OLLAMA_MODEL` instead and use `WITH_GATEWAY=1`.
