# Pharmacy domain REST + worker (wave 2b): report

Branch `feat/pharmacy-niche`, local only. Contract: `API.md` (deviations and additions are in its section 14). Everything below was exercised against the local Postgres/Redis (real HTTP calls with one throwaway business, deleted afterwards) and by unit tests.

## 1. Routes: done vs not

All routes from API.md sections 3 to 10 are implemented. `Perm` and CRF are enforced with `@RequirePermission` / `@RequireCrf` and every query is scoped by `member.businessId`.

| Area | Routes | State |
| --- | --- | --- |
| Team | `GET/POST /team/members`, `POST .../invite`, `.../:id/resend-invite`, `PATCH .../:id`, `POST .../:id/disable`, `.../enable`, `DELETE .../:id`, `GET /team/invites/:token`, `POST /team/invites/accept`, `GET/POST /team/roles`, `GET /team/roles/permission-sections`, `PATCH/DELETE /team/roles/:id`, `GET /team/access-log` | done |
| Password recovery | `POST /auth/member/forgot-password`, `POST /auth/member/reset-password` | done |
| Branding | `GET/PUT/PATCH /businesses/me/branding` (foundation, now logged), `POST /businesses/me/branding/logo`, `GET /public/businesses/:businessId/logo` | done |
| Pharmacy settings | `GET/PUT /pharmacy/settings`, `POST .../proposals/:fieldKey/confirm|dismiss`; proposals are created by `POST /onboarding/profile/field` for farmacia fields | done |
| Products | `GET /products`, `GET/PATCH /products/:id`, `POST /products`, `POST /products/:id/class`, `POST|DELETE /products/:id/image`, `GET /public/products/:id/image` | done |
| Catalog import | `POST/GET /catalog-imports`, `GET .../:id`, `POST .../:id/mapping`, `GET .../:id/class-proposals`, `POST .../:id/apply` (200 sync, 202 for big files) | done (`.xls` rejected, see gaps) |
| Class review | `GET /catalog/class-review`, `GET .../groups/:key/products`, `POST .../groups/:key/confirm` | done |
| Orders | `GET /orders`, `GET /orders/couriers`, `GET /orders/:id`, `POST .../confirm|out|done|cancel`, `PUT .../courier`, `GET /public/orders/:statusToken` | done |
| Prescriptions | `GET /prescriptions`, `GET .../:id`, `GET .../:id/file`, `POST .../approve|reject`, visitor `POST /chat/:businessId/conversations/:conversationId/prescriptions` | done |
| Handoffs | `GET /handoffs`, `GET .../:id`, `POST .../reply|close` | done |
| Customers | `GET /customers`, `GET /customers/:id` (no health data) | done |
| Dashboard | `GET /dashboard/summary`, `GET /analytics/pharmacy/overview`, `GET /notifications/summary` | done |
| Internal (worker) | `POST /internal/businesses/:id/catalog-imports/:importId/map|apply`, `POST /internal/pharmacy/order-reminders|stale-sheet|retention-purge` | done |
| Order creation | `OrdersService.createFromCart` (exported by `OrdersModule`), not an HTTP route | done, **not yet bound** to the chat engine (wave 3) |

Worker (`apps/worker`): queue `catalog-import` (jobs `map`, `apply`, concurrency 1) and the scheduled queues `pharmacy-order-reminders` (every minute), `pharmacy-stale-sheet` (hourly), `pharmacy-retention-purge` (daily 03:30). The worker only triggers the API's internal endpoints (retried, one at a time); the logic lives next to the Prisma models. BullMQ queue names cannot contain `:`, hence the hyphens.

## 2. How to call it (dev)

Log in with a member (see FOUNDATION_REPORT section 3 for creating demo members), keep the cookie jar, then:

```
A=http://localhost:3006/api
curl -c j -X POST $A/auth/member/login -H 'content-type: application/json' -d '{"email":"...","password":"..."}'
curl -b j $A/orders?status=new                       # tabs: new|confirmed|out|done|canceled
curl -b j -X POST $A/orders/<id>/cancel -H 'content-type: application/json' -d '{"reasonCode":"out_of_stock"}'
curl -b j -X POST $A/catalog-imports -F file=@estoque.xlsx    # then GET until status != uploaded
curl -b j -X POST $A/catalog-imports/<id>/mapping -H 'content-type: application/json' -d '{"columns":[{"sourceColumn":"Produto","field":"name"}, ...]}'
curl -b j -X POST $A/catalog-imports/<id>/apply -H 'content-type: application/json' -d '{"stockAsOf":"2026-10-13T14:00:00Z","stockUpToDateConfirmed":true}'
```

Without a worker the API runs a stalled import job itself after 8 s of polling (`CATALOG_IMPORT_FALLBACK_SECONDS`, `0` = off). With the worker: `cd apps/worker && pnpm dev` (needs Redis, the API and `INFERENCE_GATEWAY_TOKEN`; `NEXT_PUBLIC_API_URL` must point at the API). With the inference gateway down the import falls back to header heuristics (`mapping.modelUsed = false`, every column `low`). New invites return `inviteUrl` when `RESEND_API_KEY` is not set (also logged on the API console); password-reset links are only logged.

Dependency added: `exceljs@4.4.0` in `apps/api` (xlsx reader).

## 3. What was built where

```
apps/api/src/modules/
  pharmacy-common/        labels (pt-BR maps), format, atomic PED-/RX- counters (UPDATE ... RETURNING), sheet freshness helper, safe local storage + magic-byte sniffing
  team/                   members, invites (hashed tokens), roles + permission grid, access log, password reset
  pharmacy-settings/      settings get/put with validation, CNPJ check digits, proposals parser + confirm/dismiss
  pharmacy-notifications/ non-disableable alerts + e-mail fan-out by permission (global module), implements the chat engine's notifier port
  products/               products, images, class reference list (versioned, curated excerpt), class review
  catalog-import/         sheet parser (xlsx/csv), header detection, heuristic + model mapping, import plan (create/update/skip), service, queue
  orders/                 state machine, canEnterCart/autoConfirmDecision, DTOs, OrdersService (+ createFromCart, reminders, stale sheet), public status
  prescriptions/          private upload/download, approve/reject (+ order cascade), retention rules + purge job
  handoffs/               list/detail/reply/close, brief rows, in-stock-only suggestions
  customers/              + customers-admin (staff list/detail)
  pharmacy-dashboard/     summary, analytics, notifications summary, time zone buckets, deterministic insights
  (edited) businesses (logo, branding log), billing (billing.change log), onboarding (proposals hook), knowledge (hides catalog sheets), app.module
apps/worker/src/          processors/catalog-import.ts, processors/pharmacy-jobs.ts, internal-api.ts (postInternalApi), index.ts
apps/api/test/            pharmacy-orders, pharmacy-catalog-import, pharmacy-access, pharmacy-settings-team, pharmacy-handoffs (+ support/pharmacy-env.ts)
```

Safety rules enforced in code (not by the model): `controlled`/`unclassified` never enter an order (`canEnterCart`, re-checked in `createFromCart`); a prescription product needs an attached upload and the order is never auto-confirmed; only a confirmed `otc` is `orderable`; re-imports never change a confirmed class (a differing proposal only sets `needsReview`) and never overwrite fields the owner edited (`overriddenFields`); the reference list wins over a lenient sheet value for controlled substances; prescription files live under `LOCAL_STORAGE_DIR/private/prescriptions/...`, are only served by the access-checked `GET /prescriptions/:id/file` (private, no-store, nosniff, logged, 410 after purge); no health text in access log, alerts, emails, push payloads or analytics.

## 4. Tests

`cd apps/api && node --import tsx --test test/*.test.ts`: 342 pass (wave 1 had 178; the rest includes other agents' tests). New here: order state machine (every status x action x fulfillment), RX_PENDING, courier rules, `canEnterCart`/`autoConfirmDecision` per rule, stale-sheet helper, DTOs and public page, permission matrix (every pharmacy route x every starter role vs the guard, plus CRF), import mapping with and without a model (header detection, heuristics, model-answer validation incl. injection, CSV/xlsx parsing), class proposals order and safety override, plan (dedupe, overrides, never-downgrade), retention rules and purge job, prescription access control, settings validation and proposals confirm (incl. owner-only identity), team rules through the service (manager vs owner, last owner, CRF, own role, custom role validation), handoff briefs/suggestions/reply, dashboard buckets by time zone and insights. Typecheck: `cd apps/api && npx tsc --noEmit -p tsconfig.json` and `cd apps/worker && npx tsc --noEmit` are clean.

## 5. For wave 3 (integration)

1. Bind the chat engine to this domain (chat module files are 2a's): `{ provide: PHARMACY_ORDERS_PORT, useExisting: OrdersService }` (import `OrdersModule`) and `{ provide: PHARMACY_NOTIFIER_PORT, useExisting: PharmacyNotificationsService }` (global). Until then the engine's own Prisma-direct order creation and `AlertsPharmacyNotifier` run (they work, but without the e-mails, the waiting reminders and the clean-up of alerts when an order is acted on). Order status URL helper: `orderStatusUrl(token)` = `${NEXT_PUBLIC_CHAT_URL}/pedido/<token>`.
2. Start the worker next to the API so the reminders, stale-sheet and retention jobs run (the import has the inline fallback, the scheduled jobs do not).
3. Seed: members (pharmacist needs a CRF), a catalog (import `estoque` sample or insert products), confirm classes with the pharmacist login. Orders auto-confirm only with fresh stock (`stockAsOf`) and a delivery area configured.
4. `.local-storage/` holds product images, logos, catalog sheets and prescriptions; it is git-ignored and never served statically.

## 6. Gaps and decisions to know

- **`.xls` is rejected** (clear message to save as xlsx/csv). Reason: the only xls reader (SheetJS) has open advisories and files are untrusted uploads.
- **No staff web-push** (v1 decision): alerts + e-mail + sidebar counts only. Customer e-mail on status change exists but is a stub (logs) without `RESEND_API_KEY`.
- **Insights have no model rewrite**; the deterministic text is the product.
- **Model class proposals** only run at apply (capped at 200 products per import); everything else the sheet/reference could not classify stays unclassified. The bundled reference list is a **curated excerpt written from general knowledge, not legally reviewed**: the pharmacist confirms every class.
- **Auto-confirm** needs: fresh stock on every line, a configured delivery area containing the address (empty area list = never auto for delivery), `autoConfirmEnabled`. "Pharmacy open" is deliberately not a blocker (HANDOFF: accepted for next opening).
- Duplicate rows in one sheet: first wins, stock is never summed; products missing from a new sheet are untouched (their `stockAsOf` just gets old).
- "answered -> open when the customer writes again" is done lazily when handoffs are read (not by the chat engine).
- `PATCH /businesses/me` still passes the raw body to Prisma (pre-existing, noted in wave 1); not touched here.
- The order timeline for orders created by the chat engine's own port has no `reason`/"Confirmação automática" label difference; nothing breaks, the DTO labels come from the status.
- Platform admin visibility of pharmacy conversations (HANDOFF 5.7) is unchanged and still open.
