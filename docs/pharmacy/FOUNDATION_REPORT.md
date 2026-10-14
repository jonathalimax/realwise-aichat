# Pharmacy foundation (wave 1): report

Branch `feat/pharmacy-niche`, local only (no push/PR/deploy). Read `PLAN.md`, then `API.md` (the contract), then this file.

## 1. What was built

1. **Schema + migrations** (additive, applied to the local `realwise` DB only)
   - `Niche += farmacia` (own migration, an enum value cannot be used in the transaction that adds it).
   - HANDOFF 5.1 models: `Product`, `CatalogImport`, `Order`, `OrderItem`, `PrescriptionUpload`, `PharmacistHandoff`, `PharmacySettings` + enums (`ProductClass`, `OrderStatus`, `Fulfillment`, `CatalogImportStatus`, `PrescriptionStatus`, `HandoffReason`, `HandoffStatus`).
   - Team: `Role` (permissions JSON, `key` for starters, `requiresCrf`, `ownDeliveriesOnly`), `BusinessMember`, `MemberInvite` (`kind` invite | password_reset), `AccessLogEntry`.
   - `CustomerAddress` (Appendix A), `OrderStatusEvent` (timeline), `Order.courierMemberId`, `Product.imageKey`.
   - `Business.primaryColor/secondaryColor/tertiaryColor`; `Message.kind/authorMemberId/authorRole/authorName/uiData`; `Conversation.pharmacyState`; `PrescriptionUpload.orderId` nullable (+ `conversationId`, `leadId`) because the photo is uploaded before the order exists.
   - Backfill in the migration: starter roles for every existing business (3 for real estate / dealership: owner, manager, attendant; 5 for pharmacy) + an active Owner member per business (phone = `Business.phone`, email = `Business.email`). Idempotent; tested against a sample row.
2. **Auth + permissions**: member login (email + password), `GET /auth/me`, `PUT /auth/me/credentials`; phone (Firebase) owner login now issues member-aware sessions; old cookies without `memberId` still work (resolve to the primary Owner). `PermissionsGuard`, `@RequirePermission(section | section[], level)`, `@RequireCrf()`, `@CurrentMember()`, `AccessLogService.record()`, `StarterRolesService`, pure `team-rules.ts`. **All existing controllers are now permission-gated** (real-estate sections `leads, imoveis, agenda, conhecimento, configuracoes, inicio, conversas, analises, plano`).
3. **Niche scaffolding**: persona **Alex**, `niche-behavior.ts` (single exhaustive registry replacing every `niche === "concessionaria" ? … : …`), `farmacia.flow.json` stub, `profile-schema/src/niches/farmacia.ts` (D7 interview questions, chips, fixed flows, eval questions, `farmaciaSettingsFieldMap`), `Record<Niche, …>` for flows, templates, personas, financing, shared knowledge. Marketing page `/farmacia`, onboarding niche picker option, frontends exhaustive.
4. **Customer profile** (`apps/api/src/modules/customers/`): phone recognition, address CRUD with history, ViaCEP + BrasilAPI fallback, number normalization, masking, differs-from-saved, widget endpoints (documented in API.md section 9).
5. **Docs**: `API.md` (the contract), this report.

## 2. File map

```
packages/db/prisma/schema.prisma                                  all models (formatted by prisma format; whitespace diff is noisy)
packages/db/prisma/migrations/20261013233700_niche_farmacia/
packages/db/prisma/migrations/20261013233723_pharmacy_niche_team_access/        tables + backfill
packages/db/prisma/migrations/20261013235447_pharmacy_chat_state_and_invite_kind/  (+ final starter grids UPDATE)
packages/db/prisma/migrations/*_order_status_events_and_rx_before_order/
packages/shared/src/permissions.ts      sections, levels, starter grids, validation (single source of truth, also feeds the SQL backfill)
packages/shared/src/branding.ts         default colours + resolveBranding
packages/auth/src/session.ts            BusinessSessionClaims += memberId, roleId, roleKey, permissions
packages/profile-schema/src/niches/farmacia.ts, index.ts, types.ts (NicheKey)
apps/api/src/modules/access/            AccessModule (global): guard, decorators, rules, log, member context/auth, starter roles
apps/api/src/modules/auth/              + /auth/member/login, /auth/me, /auth/me/credentials, identify returns returning+firstName
apps/api/src/modules/customers/         address-utils, cep-lookup, customer-profile.service, controller, module
apps/api/src/modules/businesses/        branding GET/PUT, public block (branding, persona, pharmacy), niche sync of starter roles
apps/api/src/modules/chat/niche-behavior.ts, personas.ts (Alex), flows/farmacia.flow.json, safe-replies/flow/chat/simulator/... (exhaustive)
apps/api/src/common/guards/business-session.guard.ts   now resolves req.member (DB, every request)
apps/api/test/team-access.test.ts, customer-profile.test.ts, niche-scaffolding.test.ts
apps/marketing/src/app/farmacia, farmacias, lib/niches.ts
docs/pharmacy/API.md, FOUNDATION_REPORT.md
```

## 3. Running locally

All commands: `export PATH=/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:$PATH`. Postgres 17 (`localhost:5432`, role/db/password `realwise`, `vector` extension) and Redis (`localhost:6379`) are running.

| Service | Command (from repo root) | Port |
| --- | --- | --- |
| API | `cd apps/api && pnpm dev` (ts-node-dev; **do not use `nest build` + `node dist`**: workspace packages are TS-only, that path fails on `@realwise/auth` already on `main`) | 3006 (`/api/...`, health `/api/health`) |
| Worker | `cd apps/worker && pnpm dev` (needs Redis + API + `INFERENCE_GATEWAY_TOKEN`) | none |
| Inference gateway | `cd apps/inference-gateway && pnpm dev` (no Ollama locally: model calls degrade) | 3002 |
| Dashboard | `cd apps/dashboard && pnpm dev` (basePath `/imobiliaria/app`) | 3003 |
| Admin | `cd apps/admin && pnpm dev` | 3004 |
| Chat widget | `cd apps/chat && pnpm dev` (basePath `/client/conversation`, e.g. `http://localhost:3005/client/conversation/<slug>`) | 3005 |
| Marketing | `cd apps/marketing && pnpm dev` | 3007 |

Frontends default to `http://localhost:3006/api` (Next only reads `.env*` inside each app folder, not the root `.env`).

### Env (git-ignored root `.env`, local values only; no secrets listed)

`DATABASE_URL` (local), `SESSION_SECRET` (random 64 hex), `INFERENCE_GATEWAY_TOKEN` (random), `CALENDAR_TOKEN_ENCRYPTION_KEY` (random), `LOCAL_STORAGE_DIR` = `<repo>/.local-storage` (git-ignored via `.gitignore`; the API serves no static files, keep prescriptions under `private/prescriptions/…`), `REDIS_URL`, `API_PORT=3006`, `CORS_ALLOWED_ORIGINS` (3003, 3004, 3005, 3007), `NEXT_PUBLIC_API_URL=http://localhost:3006/api`, `NEXT_PUBLIC_CHAT_URL=http://localhost:3005/client/conversation`, `VAPID_*` (generated with web-push), `SEED_ADMIN_EMAIL=admin@local.test` / `SEED_ADMIN_PASSWORD` (admin login, seeded into the local DB), `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` = obvious placeholders (the API refuses to boot without them). Firebase is NOT configured, so **owner phone login does not work locally**: log in with member email + password instead.

### Making a local demo login (wave 3 seeds should do this)

```ts
// inside apps/api (tsx): create business, starter roles + owner, then set a password
const b = await prisma.business.create({ data: { name, slug, niche: "farmacia", phone, ownerName, email, status: "live" } });
await new StarterRolesService({ client: prisma } as any).ensureForBusiness(b);        // 5 starter roles + Owner member
await prisma.businessMember.updateMany({ where: { businessId: b.id, role: { key: "owner" } }, data: { passwordHash: await bcrypt.hash("…", 10) } });
// other roles: prisma.businessMember.create({ data: { businessId, email, name, passwordHash, roleId, status: "active", crf } })
// pharmacist needs a CRF to pass @RequireCrf()
```

Then `POST /api/auth/member/login {email, password}`. Smoke-tested during this wave (owner, attendant 403, public business block, CEP via real ViaCEP, legacy-cookie session), then the smoke data was deleted: the local DB has the seeded plans + admin only.

## 4. Tests and checks (all green at the end of wave 1)

```
cd apps/api && node --import tsx --test test/*.test.ts      # 178 pass (baseline 141 + 37 new)
cd apps/api && npx tsc --noEmit -p tsconfig.json
cd apps/{dashboard,chat,marketing,admin,worker,inference-gateway} && npx tsc --noEmit
```

New test files: `team-access.test.ts` (grids vs prototype matrix, CRF rules, owner protection, last owner, guard 403 shape, access log, member login incl. ambiguity, migration backfill in sync with shared grids), `customer-profile.test.ts` (S/N normalization, masking, differs flag, ViaCEP/BrasilAPI with fake fetch, never-overwrite-default), `niche-scaffolding.test.ts` (every niche covered, Alex rules, pharmacy never uses real-estate/vehicle copy, unchanged copy for the others).

## 5. Things wave 2 must know

- **Message roles**: human replies use the existing `role: "owner"` (+ `authorMemberId/authorRole/authorName`); the join banner is `role: "system"`, `kind: "human_joined"`. The chat app already renders `owner` and `system` roles.
- `BusinessSessionGuard` hits the DB on every request (member + role). Always pair `@UseGuards(BusinessSessionGuard, PermissionsGuard)`.
- `AccessLogService` is global; pass `summary` (pt-BR sentence) and never health data.
- Pharmacy never reaches rent/buy triage, visit scheduling, listing cards, selection shortcuts or financing: that is encoded in `niche-behavior.ts` (`usesListingEngine`, `usesRentBuyTriage`, `supportsFinancingSimulation`, `scheduling: null`, `engagementEvents: "none"`). Remaining `TODO(wave2:chat-engine)` stubs: persona free-text rules, flow stub, engagement events, `nicheBehavior("farmacia")` copy. The lane router / hard rules must be added **before** the model path in `ChatService` (see HANDOFF 5.4); today a pharmacy visitor falls into the generic RAG path with persona Alex.
- `Business.brandColor` is legacy: the foundation keeps it in sync with `primaryColor` and `resolveBranding` falls back to it.
- Existing `PATCH /businesses/me` still passes the raw body to Prisma (pre-existing; I whitelisted branding only). Worth hardening in 2b if you touch it.
- Orders get `PED-<number>`: allocate with an atomic `UPDATE "PharmacySettings" SET "nextOrderNumber" = "nextOrderNumber" + 1 … RETURNING` (create the settings row first); same for `nextRxNumber`.

## 6. Known gaps (deliberate)

- Not built (wave 2): team/roles/invite/accept/access-log REST, branding logo upload, pharmacy settings + proposals, products, import + worker jobs, class review, orders, prescriptions, handoffs, customers list, dashboard/analytics/notifications endpoints, chat engine, all UI. The contract for each is in API.md.
- No local demo seed script yet (wave 3).
- `scripts/seed-shared-knowledge.ts` iterates two niche folders only; no curated shared knowledge exists for pharmacy.
- Platform admins can read pharmacy conversations in `apps/admin` `MessageMirror` (HANDOFF 5.7 open decision, untouched).
- Staff web-push is not in v1 (alerts + email + badges only).
- Prisma `migrate reset` is blocked for agents, so after editing an already-applied migration I restored its original content and added the correction to a later migration instead of resetting the DB.
- The dashboard sidebar is still not niche-/permission-aware (2c).
- `prisma format` re-aligned `schema.prisma`; review diffs with `git diff -w`.
