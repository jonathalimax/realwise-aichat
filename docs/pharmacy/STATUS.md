# Pharmacy niche: status after integration (wave 3)

Branch `feat/pharmacy-niche`. Local only: nothing deployed, nothing merged. How to run it: `LOCAL.md`.

## What was verified, and how

| Layer | Verified how |
| --- | --- |
| API tests | `cd apps/api && node --import tsx --test test/*.test.ts`: **354 pass, 0 fail** (342 before wave 3, +12: bindings, upload ownership, minimum order, rx.check, contact form). Run with `--test-force-exit` if a runner hangs after finishing (two test files import Nest modules that keep Redis handles open; they exit themselves). |
| Typecheck | `tsc --noEmit` clean in api, worker, dashboard, chat, marketing, admin, inference-gateway |
| Builds | `next build` green for dashboard, chat, marketing |
| API over HTTP, real Postgres/Redis, real running API + worker | all five logins and a permission probe (13 routes x 5 roles); chat as a visitor (OTC delivery with a returning customer, pickup, Rx with photo before phone, controlled, unclassified, symptom questionnaire to handoff, red flag, out of stock with equivalent, hours/fee, dose refusal); pharmacist reply and human-joined message; Rx approve/refuse by role; order confirm/out/done/cancel with courier rules; both sample sheets imported end to end (mapping, class proposals, apply, class group confirm, role checks); team invite + accept + login; branding update seen by the public endpoints; public order status; retention purge (file deleted, download 410); internal reminder/stale-sheet jobs; the worker ran the scheduled reminder job by itself |
| Browser (headless Google Chrome through `playwright-core`, already in `node_modules`, no install; plus the in-app browser pane) | dashboard login for each role and a sweep of 13 pages per role (sidebar, "sem acesso" pages, no 5xx), real screenshots of Pedidos, Catálogo, Início, order sheet, Atendimento, order status page and widget (with a human-joined banner) at phone width, branding colours changing in dashboard, widget and status page, the widget checkout (phone, name form, address form with a real CEP lookup, out-of-area message) |
| Real-estate regression | a temporary real-estate business (since deleted) logged in to the dashboard (sidebar, Leads, Inbox, Anúncios, Equipe load) and its chat loaded and greeted as Clara; its API tests are part of the 354 |

## Bugs found while integrating and fixed

1. Chat engine ports were still the Prisma-direct fallbacks: now `PHARMACY_ORDERS_PORT -> OrdersService`, `PHARMACY_NOTIFIER_PORT -> PharmacyNotificationsService` (no module cycle: ChatModule imports OrdersModule, notifications module is global).
2. A pickup order below the delivery minimum failed ("Não consegui concluir"): `OrdersService` applied the minimum to pickup, the chat says it is for delivery only. Fixed in the service.
3. A prescription photo could not be uploaded before the phone number (403) although the Rx lane asks for the photo first. Upload now accepts the visitor that owns the conversation (anonymous or identified); it is stored with `conversationId`, `orderId = null`, lead null or the conversation's lead, and `createFromCart` attaches it and stamps the lead. `rx.check` picks it up.
4. `rx.check` answered "received" and "not received" in the same turn.
5. The widget's contact form (phone + name, empty optional e-mail) made the engine ask for the e-mail again and re-render a phone form. A submitted name with an empty e-mail now skips the e-mail; the e-mail/consent follow-up card no longer asks for the phone again.
6. An urgent-handoff alert could be hidden by an older alert of the same type: the bound notifier creates one row per event; the fallback notifier uses `pharmacy_urgent_handoff` for urgent ones.
7. Dashboard: greeting said "Boa noite, Dra." (honorific); alert strip now shows critical alerts first; couriers no longer poll the forbidden `/alerts` route.
8. Seed images and the join banner role label fixed.

## Status table

| Area | State |
| --- | --- |
| Schema, migrations, roles/permissions, access log | done |
| Chat engine (red flags, lanes A-F, cart, checkout, symptom, handoff, guards) with no model | done, verified |
| Orders (state machine, auto-confirm, cancel reasons, courier, public status page) | done, verified |
| Prescriptions (private storage, approve/reject, retention purge) | done, verified |
| Catalog import (xlsx/csv, heuristic mapping, reference classes, class review) | done, verified; model mapping/class proposals only with a model, **not exercised** |
| Handoffs (list, brief, reply, human-joined banner) | done, verified |
| Team (invite, accept, roles grid, access log, password reset) | done; invite/accept verified; reset-password routes verified by unit tests only |
| Branding + settings | done, verified (logo upload not exercised in the browser) |
| Dashboard summary, notifications, badges | done, verified; analytics page loads, numbers not audited by hand |
| Worker jobs | reminders ran by themselves; stale sheet and purge called manually; the 03:30 schedule not waited for |
| Seed, one-command start, docs | done |
| Operation mode `commerce` / `attendance` tied to the plan (`pharmacyCommerce`: essencial = attendance only; profissional/studio = either), interview field, settings tab, guards, attendance chat lane, dashboard and widget adaptation | done, see `OPERATION_MODE.md`; verified with API tests (`pharmacy-attendance.test.ts`), over HTTP (login, 403 codes, summary, chat product request) and in the browser (sidebar, Modo de operação tab, blocked page); the plan-forced banner and the role editor greying were typechecked/built but not clicked |
| Language-model paths (RAG answers, model mapping, model class proposals, insights rewrite) | **not done / not tested** (no model locally; graceful fallbacks verified) |
| Payment online, WhatsApp channel, staff web push, customer e-mail on status change (logs only) | not done (out of scope for v1) |
| Dark mode for the pharmacy palette | not done |
| Playwright/automated browser tests in the repo | not done (browser checks were manual scripts, not committed) |

## Verified in a browser vs only over HTTP

- Browser: logins, role sidebars and "sem acesso" pages, Início, Pedidos (list, sheet), Catálogo (list), Atendimento, status page, widget (cart, contact form, address form, out-of-area, human banner, branding).
- Only over HTTP (UI not clicked this time): prescription upload from the widget camera/file control, import stepper UI (the same routes were run over HTTP), class review UI, team invite dialog and accept page, role grid editor, branding colour pickers, order cancel dialog, handoff reply box, retention purge. Their pages load without errors for the right roles; the actions were exercised through the API they call.

## Legal and compliance caveats (HANDOFF 5.7)

- Nothing here is legal review. Symptoms, allergies and prescriptions are sensitive health data (LGPD). Consent records and retention exist, but the wording and the 30-day default retention need the pharmacist's and a lawyer's review before any real use.
- The **curated list of controlled and prescription substances** (`apps/api/src/modules/products/class-reference.ts`, version `ref-2026.10`) is an excerpt written from general knowledge. It is not legally reviewed and is not complete. The pharmacist must confirm every class; the code only uses it to propose, and a listed controlled substance cannot be downgraded by a sheet.
- The symptom -> product suggestion table (pharmacist-only, never shown to the customer) is a convenience, not clinical logic; it needs the responsible pharmacist's review.
- Platform admins can still read pharmacy conversations in `apps/admin` `MessageMirror` (HANDOFF 5.7 decision still open, untouched).
- Prescription retention for abandoned uploads is capped at 90 days; closed orders follow `prescriptionRetentionDays`.

## Decisions that need the owner (HANDOFF OPEN list)

1. Who the responsible pharmacist is and whether handoffs are answered from the dashboard (built that way).
2. Pharmacy pricing/plan and quota rules (the demo uses the existing "Profissional" plan). Decided for the mode only: essencial = attendance, profissional and studio = commerce allowed (`OPERATION_MODE.md`); prices and quotas are unchanged.
3. Prescription photo retention period and legal basis (30 days after closing, configurable).
4. Which OTC items always need a pharmacist (per-product switch exists in Catálogo; no bulk list).
5. Customer order updates without WhatsApp (status link works; e-mail only logs without `RESEND_API_KEY`).
6. Pickup payment (assumed in store).
7. Attendance mode: whether the product-request lane should also ask for the customer's phone (the WhatsApp hand-over feature owns phone capture, not integrated here), and whether the Essencial plan should keep the order status page for old orders (today the public status link keeps working).
Also open: hiding pharmacy conversations from platform admins; whether orders outside opening hours may be accepted (currently yes); whether the e-mail on new orders should skip the courier role; whether abandoned prescription uploads should auto-expire sooner.
