# Pharmacy niche: build plan (overnight, local-only)

Source of truth: `HANDOFF.md` (decisions, data model, lanes, safety rules) plus the owner decisions made after it, listed here. Where they differ, **this file wins**.
Design reference (clickable prototype, pt-BR): https://claude.ai/artifact/QUJVn5ufyZA7GMwr3r7TG9 . Local copy of its source: `/private/tmp/claude-501/-Users-jplima-sword-Developer-Personal-realwise-aichat/dd12cb7f-7ae4-4a56-8d12-6926765c3438/scratchpad/pharm/project/*.dc.html` and `ui.css`. Read the screens before building UI.

## Rules for this run

- Branch `feat/pharmacy-niche` (from `origin/main`). Local only: **no push, no PR, no merge, no deploy**. Never touch `.github/workflows` or any tracked `.env*` file. A local, git-ignored `.env` is allowed. Never migrate or seed anything but the local Postgres `realwise` database on `localhost`.
- GitHub account is `jonathalimax`; commits as `jonathalimax <jonathalimax@gmail.com>`. End commits with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Additive migrations only. Every query scoped by `businessId`. Visitor, KB and document text are untrusted data.
- Do not mix real estate / dealership concepts into pharmacy. Real-estate and vehicle behavior must not regress (all existing API tests stay green).
- Make niche behavior exhaustive (`Record<Niche, …>` or `switch` with a `never` check) so a missing niche is a compile error.

## Decisions made after the handoff (owner, 2026-10-13)

1. **Persona is Alex** (a man, fixed in `personas.ts`), says in the welcome message that he is an AI assistant, and the chat header shows an "IA" badge. Real-estate stays Clara. The handoff's "Lia" is obsolete.
2. **Human join banner**: when a person (pharmacist or any employee) takes over or answers in a conversation, the chat shows a system line "Nome · Função entrou na conversa" and that person's messages carry their name and role.
3. **Team and access (all niches, not only pharmacy)**: a business registers employees with roles and permissions. Starter roles: Owner (proprietário), Pharmacist (farmacêutico RT, requires CRF), Manager (gerente), Attendant (atendente), Courier (entregador, sees only own deliveries). Custom roles with per-section none/view/edit. Rules: at least one Owner always; last Owner cannot be removed or downgraded; a Manager cannot edit Owners or grant the Owner role; confirming product classes, validating prescriptions and answering handoffs need a role flagged `requiresCrf` and a CRF on the member; new invites start as Attendant; sensitive actions go to an **access log** (v1). Manager can edit Farmácia settings, Team and Billing. Order and handoff notifications cannot be disabled.
4. **Prescriptions (Receitas) live inside Pedidos** (a tab), not a top-level section.
5. **Branding**: each business sets primary, secondary and tertiary colours (Farmácia › Aparência / Imobiliária › Aparência); default teal `#0F766E / #0B4F4A / #F59E0B` for pharmacy. Applied to the chat widget, the customer order-status page and the dashboard (CSS variables), falling back to the default when unset.
6. **Roles for dashboard visibility**: sidebar shows only sections the member can open; direct URL without access renders a "Sem acesso" page and the API returns 403.
7. Catalog list and product sheet show a product image (upload or placeholder icon by product type).

## Phases and ownership

**Wave 0 (me)**: install tooling (Homebrew: node@20, pnpm, postgresql@16, pgvector, redis), local `.env`, `pnpm install`, local DB, baseline tests green on `main`.

**Wave 1 — Foundation (one agent, must finish before wave 2)**
- Prisma: `Niche += farmacia`; every model/enum in HANDOFF 5.1 **plus** `BusinessMember`, `Role` (permissions JSON), `MemberInvite`, `AccessLogEntry`, `CustomerAddress` (Appendix A), brand colour fields on Business (or `BusinessBranding`), `Product.imageKey?`, `Message.authorMemberId?/authorRole?` for the human-join banner. One additive migration, applied to the local DB only.
- Auth: business-user login for members (today the owner logs in directly): keep existing owner login working, add member login, JWT carries `memberId`, `roleId`, resolved permissions. A `PermissionsGuard` + `@RequirePermission(section, level)` decorator. Seed Owner member for every existing business (backfill in migration or on first login).
- Niche scaffolding: persona Alex, `profile-schema/src/niches/farmacia.ts` (onboarding questions from HANDOFF D7), registry, flow JSON stub, audit and fix every binary-niche site listed in HANDOFF section 4 with exhaustive checks, signup niche selection, marketing stub page.
- Customer profile (Appendix A): phone-first recognition, `CustomerAddress`, CEP lookup behind an interface (ViaCEP/BrasilAPI with fallback), masked address, never overwrite silently.
- Write `docs/pharmacy/API.md`: the exact REST contract (routes, request/response JSON, permission per route) that wave 2 builds against. This file is the contract between backend and frontend agents.

**Wave 2 — four agents in parallel, each in its own directories**
- **2a Chat engine** (`apps/api/src/modules/chat/**`, tests): red-flag detector, lane router A–F, product resolution, deterministic cart and checkout state machine, controlled/unclassified hard rule, symptom questionnaire + `PharmacistHandoff` + brief, dosage/recommendation guards, auto-confirm rules and stale-sheet net, human-join system messages, Alex persona/copy. Extend `clara-harness.ts`; implement all scenarios in HANDOFF 5.8 with a stubbed model.
- **2b Domain REST + worker** (`apps/api/src/modules/{products,catalog-import,orders,handoffs,prescriptions,pharmacy-settings,team,roles,access-log,branding}/**`, `apps/worker/**`): everything in `API.md`, AI column-mapping import (one model call with ~20 sample rows), class proposal + review, order status machine, prescription private upload/download + retention purge job, notifications (push/alerts/email stub, non-disableable), pharmacy settings from onboarding answers, team/roles/invite/accept/access log, branding. Unit tests for status machine, permissions, import mapping, retention.
- **2c Dashboard web** (`apps/dashboard/**`): niche-aware and permission-aware sidebar, all screens from the prototype wired to the API (Início, Pedidos with Receitas tab, Atendimento farmacêutico, Catálogo with images + Revisar classes + Importar, Clientes, Conversas, Análises, Farmácia with Aparência, Equipe e acessos with roles/invite/log, Plano e cobrança, Assistente, Login, Accept invite, No access). Restyle to the shadcn-like look of the prototype using the existing `components/ui/*` primitives and tokens; keep real-estate pages working (they get redesigned in a later job). CSS variables for brand colours.
- **2d Chat widget + public pages** (`apps/chat/**`, `apps/marketing/**`): pharmacy theme (brand colours), Alex header with IA badge, product card with image, cart, symptom chips, red-flag card, controlled card, contact capture, address/CEP, order review, confirmation, Rx upload, human-join banner, order status page. Marketing page for the pharmacy niche.

**Wave 3 — Integration (one agent)**: run everything locally (API, worker, dashboard, chat), seed local demo data (script, local DB only), click through the real flows, fix breakage, make all tests, typechecks and builds pass, write `docs/pharmacy/LOCAL.md` (how to start, demo logins, what is stubbed) and an honest `docs/pharmacy/STATUS.md` (done / partial / not done).

## Definition of done for tomorrow

Owner can: start the stack locally, sign in as demo owner and as each demo role, import a sample spreadsheet, review classes, chat with Alex in the browser (OTC order, Rx order, controlled, symptom handoff, red flag), see the order arrive, progress it, answer a handoff as the pharmacist, invite an employee, see the access log. Anything not working is listed in `STATUS.md`.
