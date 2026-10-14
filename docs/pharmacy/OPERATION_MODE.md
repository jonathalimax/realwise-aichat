# Pharmacy operation mode: commerce or attendance, tied to the plan

Branch `feat/pharmacy-niche`, local only. Owner decision: a pharmacy either sells through the system (`commerce`) or only uses the AI attendant with escalation (`attendance`, "a WhatsApp with AI"). The plan decides which one is allowed.

## 1. The two modes

| | `commerce` | `attendance` |
| --- | --- | --- |
| Alex | answers, builds the cart, checkout, orders, prescriptions, symptom handoff | answers general questions (hours, delivery area, pickup, payment, FAQ from settings/KB), symptom lane, **product-request lane**; never states stock or price |
| Catalog, stock, import, class review | yes | no (403, hidden) |
| Orders, prescriptions, cart/checkout in chat | yes | no |
| Red flag lane (SAMU 192, urgent handoff) | yes | yes (unchanged) |
| Dashboard | Pedidos, Catálogo, order KPIs | Atendimento is the hero screen; Início shows open handoffs, answered today, average first response, conversations |

Never silently deleting data: a business that downgrades keeps its catalog, orders and prescriptions. They are only unreachable (API 403, menu hidden) and come back with the upgrade.

## 2. Plan rule (single plan catalog)

`packages/shared/src/plans.ts`: `PlanFeatures.pharmacyCommerce`. Use `hasFeature(plan, "pharmacyCommerce")` (api) or `resolvePlanFeatures`.

| Plan | `pharmacyCommerce` | Allowed modes |
| --- | --- | --- |
| trial / no subscription (entry tier behaviour) | false | attendance |
| `essencial` | false | attendance |
| `profissional` | true | commerce or attendance |
| `studio` | true | commerce or attendance |

Pricing bullets for the pharmacy niche come from `pharmacyPlanHighlights(plan)` (marketing `/farmacias` pricing cards and the dashboard "Plano e cobrança" page). Generic bullets are untouched.

**Effective mode** = chosen mode, forced to `attendance` when the plan lacks the feature. Pure rule: `computeOperationMode(chosen, plan, chosenAt)` in `packages/shared/src/pharmacy-mode.ts` (returns `chosen`, `effective`, `commerceAllowedByPlan`, `forcedByPlan`, `chosenAt`, `planCode`, `upgradeToPlanCode`). DB loader: `loadOperationMode(prisma.client, businessId)` in `apps/api/src/modules/pharmacy-common/operation-mode.ts`.

## 3. Schema (additive migration `20261014120000_pharmacy_operation_mode`)

- enum `PharmacyOperationMode` (`commerce`, `attendance`).
- `PharmacySettings.operationMode` (default `attendance`) and `operationModeChosenAt` (null = never explicitly confirmed by the owner).
- `HandoffReason` gets `product_request`.
- Existing rows are backfilled to `commerce` (they all sold through the system). **New pharmacies default to `attendance`** (the entry plan only allows it); the owner confirms in the interview or in Farmácia > Modo de operação.
- The demo seed sets `commerce` on `profissional` (see LOCAL.md to flip it).

## 4. Interview (onboarding)

`packages/profile-schema/src/niches/farmacia.ts`: new required, first field `modo_operacao` ("Modo de operação"), question `iq0`. It maps to `PharmacySettings.operationMode` through `farmaciaSettingsFieldMap` and becomes a pending proposal the owner confirms in Farmácia (nothing is applied silently).

Without a model, the scripted interview fallback (`onboarding.service.ts`) classifies the owner's reply with `classifyOperationModeAnswer` (`pharmacy-settings/proposals.ts`, deterministic pt-BR):

- commerce: estoque, vender/venda, pedidos, catálogo, comércio, carrinho, loja virtual ...
- attendance: só/apenas atendimento, escalar, encaminhar, whatsapp, "sem estoque", "não quero vender" ...
- negations are respected ("sem estoque" is not a commerce signal); both signals, or none, mean **ambiguous**: the answer is not saved and Alex asks again ("responda comércio ou atendimento"). The same guard applies when a model extracts the field.

## 5. API behaviour

- `GET /auth/me` -> `business.operationMode` (the full info object, `null` for other niches); `visibleSections` drops the commerce sections in attendance.
- `GET /businesses/public/:slug` -> `pharmacy.operationMode` (effective mode only; the widget hides cart/product UI).
- `GET /pharmacy/settings` -> `mode` (info object) + `settings.operationMode`, `operationModeChosenAt`. `PUT /pharmacy/settings { operationMode }`: **owner only** (`OWNER_PROTECTED`), `commerce` on a plan without the feature -> 403 `PLAN_FEATURE` with `upgradeTo`. Proposal confirm for `modo_operacao` follows the same rules. Chosen time is recorded.
- Commerce-only routes (`CommerceModeGuard` in `access/commerce-mode.guard.ts`): products (+ class review), catalog imports, orders, prescriptions (staff routes **and** the visitor upload). 403 body `{ statusCode, error, code: "PLAN_FEATURE" | "MODE_ATTENDANCE", message, upgradeTo? }`: `PLAN_FEATURE` when the plan blocks it, `MODE_ATTENDANCE` when the owner chose attendance. Public order status links and internal jobs are untouched.
- `GET /dashboard/summary`: `mode`, attendance KPIs (`open_handoffs`, `answered_today`, `avg_first_response`, `conversations`), `stock`/`needsAction`/`chart`/`funnel` empty. `GET /analytics/pharmacy/overview`: attendance KPIs, no revenue/top products/unmet demand. `GET /notifications/summary`: no orders, prescriptions or stock sheet. Order reminders and stale-sheet jobs skip attendance pharmacies.

## 6. Chat engine (attendance)

`apps/api/src/modules/chat/pharmacy/attendance.ts` (pure copy/helpers) + `pharmacy-chat.service.ts` (`routeAttendance`, product-request lane). Every turn loads the effective mode; old commerce state (cart, checkout, Rx line, focus) is parked in the conversation, never used.

- Skipped entirely: product resolution, cart, checkout, address/CEP, prescription upload, controlled/Rx lanes, order status, stock-based suggestions in the symptom brief. Structured widget actions (`cart.*`, `checkout.*`, `rx.check`) get a polite answer.
- Kept: red flags (SAMU 192, urgent handoff), symptom questionnaire -> handoff, general lane (settings facts, KB through the model with guards), dosage refusal, "falar com o farmacêutico", human-joined banner.
- New **product-request lane**: "tem dipirona?", "quanto custa X", "quero X" -> Alex says he does not consult stock or price (the pharmacist confirms), asks consent (LGPD, `ConsentRecord` purpose `product_request`) -> creates a `PharmacistHandoff` with reason `product_request` and brief `{ requestedProduct, customerRequest, availability, conversationLink }`. A second request in the same conversation updates the same open handoff (up to 5 requests joined).
- Chips adapt: "Falar com o farmacêutico", "Horários e entrega", "Perguntar sobre um produto". The scripted welcome and the model prompt (attendance rule) never mention orders.
- Not implemented: asking for the customer's phone in this lane (the WhatsApp hand-over feature owns phone capture; today the pharmacist answers in the chat).

## 7. Dashboard and widget

- Sidebar hides Pedidos and Catálogo (importar/classes live under Catálogo); Atendimento sits first. Commerce URLs show a "Esta farmácia está no modo atendimento" panel; when the **plan** forces it, the panel and a banner on Início and Farmácia carry an upgrade CTA to Plano e cobrança.
- Farmácia: new tab **Modo de operação** (two cards, owner only; commerce disabled with "Disponível a partir do plano Profissional" + CTA when the plan lacks it; downgrade note). In attendance, the tabs Entrega, Retirada, Limites and Estoque collapse into one informational tab "Entrega e retirada" (fee, areas, pickup, payment, exchange policy: Alex only uses them to answer questions). Identidade, Horários, Aparência stay.
- Roles editor (Equipe e acessos > função): commerce sections are greyed out and locked ("Não se aplica no modo atendimento"); stored permissions are kept.
- Widget: no cart bar; welcome text and chips adapt (`apps/chat/src/components/pharmacy/mode.ts`).

## 8. Tests

`apps/api/test/pharmacy-attendance.test.ts` (18): plan catalog and effective mode, guard codes, attendance never orders/carts/states price or stock, product question -> handoff, red flag still works, symptom handoff without suggestions, general lane, commerce unchanged, plan downgrade forces attendance (and upgrade restores), trial = attendance, classifier, scripted interview, owner-only/plan-gated settings. Harness: `createPharmacy({ plan, settings: { operationMode } })` (default profissional + commerce, so every older test is unchanged) and `p.setPlan(...)`.
