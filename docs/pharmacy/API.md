# Pharmacy niche: REST contract (API.md)

This file is the contract between backend and frontend agents of wave 2. **Build exactly this.** If you
must deviate, change this file in the same commit and say so in your report. Where HANDOFF.md and PLAN.md
differ, PLAN.md wins. Copy is pt-BR; code, routes and JSON keys are English/camelCase (the section keys for
permissions are the Portuguese names fixed below).

Legend used in the route tables:

- **Status**: `FOUNDATION` = already implemented and tested in wave 1 (use it, do not rewrite it). `2a` chat engine, `2b` domain REST + worker, `2c` dashboard web, `2d` chat widget + public pages.
- **Perm**: `section:level` for `@RequirePermission(section, level)`. `+CRF` also needs `@RequireCrf()` (role flagged `requiresCrf` AND a CRF on the member). `any` = any authenticated member. `public` = no session. `visitor` = visitor session (anonymous or identified, see section 1.2).

---

## 0. Foundation: what already exists (read before building)

| Piece | Where |
| --- | --- |
| Schema (all models and enums below) | `packages/db/prisma/schema.prisma`, migrations `20261013233700_niche_farmacia` .. `*_order_status_events_and_rx_before_order` |
| Permission model (sections, levels, starter grids, validation) | `packages/shared/src/permissions.ts` (`PERMISSION_SECTIONS`, `NICHE_SECTIONS`, `buildStarterPermissions`, `hasPermission`, `visibleSections`, `validateRoleDefinition`) |
| Branding (defaults, `resolveBranding`) | `packages/shared/src/branding.ts` |
| Session claims, member login, `GET /auth/me` | `apps/api/src/modules/access/*`, `apps/api/src/modules/auth/*` |
| `BusinessSessionGuard` (sets `req.business` claims + `req.member` MemberContext), `PermissionsGuard`, `@RequirePermission`, `@RequireCrf`, `@CurrentMember()` | `apps/api/src/common/guards/business-session.guard.ts`, `apps/api/src/modules/access/*`, `apps/api/src/common/decorators/current-business.decorator.ts` |
| Team rules (last owner, manager vs owner, CRF) as pure, tested functions | `apps/api/src/modules/access/team-rules.ts` |
| `AccessLogService.record({ businessId, actor, action, target, summary, detail })` | `apps/api/src/modules/access/access-log.service.ts` (global module, inject anywhere) |
| `StarterRolesService.ensureForBusiness / syncForNiche` | `apps/api/src/modules/access/starter-roles.service.ts` (called on signup and when niche changes) |
| Customer profile (phone recognition, addresses, CEP lookup, masking, differs flag) | `apps/api/src/modules/customers/*` |
| Persona Alex, `nicheBehavior(niche)`, pharmacy flow stub | `apps/api/src/modules/chat/personas.ts`, `niche-behavior.ts`, `flows/farmacia.flow.json` |
| Niche template (interview questions, fields) + `farmaciaSettingsFieldMap` | `packages/profile-schema/src/niches/farmacia.ts` |
| Branding endpoints and public business block | `apps/api/src/modules/businesses/*` |

Every existing real-estate/dealership controller is now gated by section permissions (an Owner keeps full access, so nothing changes for existing owners).

### 0.1 How to add a protected route (2b)

```ts
@Controller("orders")
@UseGuards(BusinessSessionGuard, PermissionsGuard)      // order matters: session first
@RequirePermission("pedidos", "view")                    // class default
export class OrdersController {
  @RequirePermission("pedidos", "edit")                  // method overrides class
  @Post(":id/confirm")
  confirm(@CurrentMember() member: MemberContext, @Param("id") id: string) { ... }

  @RequirePermission("receitas", "edit") @RequireCrf()   // pharmacist action
  @Post("prescriptions/:id/approve") ...
}
```

Always scope Prisma queries by `member.businessId` (never trust ids from the URL alone). Courier (`member.ownDeliveriesOnly`) must additionally be filtered by `courierMemberId = member.memberId` on every order query and transition.

---

## 1. Conventions

### 1.1 General

- Base path `/api` (NestJS global prefix). JSON bodies, `camelCase`. Dev origins: API `:3006`, dashboard `:3003`, chat `:3000`. The dashboard is served under basePath `/imobiliaria/app` (existing; keep).
- Money is always an **integer in cents** (`priceCents`, `totalCents`). Never floats. The UI formats `R$ 8,90`.
- Timestamps are ISO-8601 UTC strings. "há 5 min" labels are computed by the UI from timestamps (`waitingMinutes` is provided where a badge needs it).
- Ids are uuid strings. Human codes: orders `PED-<number>` (per business, starts at 1001, `PharmacySettings.nextOrderNumber` incremented atomically), prescriptions `RX-<number>`.
- Lists: `?limit=` (default 50, max 200) and `?cursor=` (opaque id of the last row); response `{ items: [...], nextCursor: string | null, ... }`. Filters/counts are described per route.
- **Never** put health text (symptoms, allergies, prescription content, patient answers) in: `AnalyticsEvent`, `AccessLogEntry`, logs, `LlmCallLog`, email subjects. Health data lives only in `PharmacistHandoff.brief`, `Message.content`/`uiData`, `PrescriptionUpload` files.
- Every query is scoped by `businessId` taken from the session (`req.member.businessId`), never from the client.

### 1.2 Auth and sessions

| Cookie | Who | Set by |
| --- | --- | --- |
| `rw_business_session` (httpOnly, 30 days, JWT) | business-side members (dashboard) | `POST /auth/business/verify` (owner phone), `POST /auth/member/login`, invite accept |
| `rw_visitor_session` / `rw_visitor_anon_<businessId>` | chat visitors | `POST /auth/visitor/identify` / `VisitorSessionGuard` |

Session JWT claims: `{ businessId, phoneNumber, memberId, roleId, roleKey, permissions }`. **The server re-resolves member, role and permissions from the DB on every request** (`BusinessSessionGuard`), so disabling a member or editing a role takes effect immediately; the `permissions` claim is only a hint. Sessions issued before the team feature (no `memberId`) resolve to the business's primary Owner. Use `credentials: "include"` on every dashboard fetch.

### 1.3 Errors

Default Nest shape: `{ "statusCode": 400, "message": "...", "error": "Bad Request" }`. Domain errors add a stable `code` (the UI switches on `code`, shows `message`).

| HTTP | When |
| --- | --- |
| 400 | validation, `code` e.g. `CEP_INVALID`, `WEAK_PASSWORD`, `INVALID_EMAIL`, `CRF_REQUIRED_FOR_ROLE`, `STARTER_ROLE` |
| 401 | no / invalid / expired session, member disabled or removed (`message` is generic) |
| 403 | permission or rule, shape below |
| 404 | not found **or belongs to another business** (never reveal which) |
| 409 | state conflict, e.g. `BUSINESS_AMBIGUOUS`, `EMAIL_IN_USE`, `INVALID_TRANSITION`, `RX_PENDING`, `ROLE_IN_USE` |
| 410 | purged resource (prescription file after retention) |
| 429 | rate limit |

**403 shape (fixed, produced by `accessDenied()`):**

```json
{ "statusCode": 403, "error": "Forbidden", "code": "PERMISSION_DENIED",
  "message": "Você não tem acesso a \"Catálogo\" (edição).", "section": "catalogo", "required": "edit" }
```

`code` is one of `PERMISSION_DENIED` (+`section`, `required`), `CRF_REQUIRED` (+`section`,`required`: needs a pharmacist with CRF), `OWNER_PROTECTED` (manager touching an owner / granting owner / editing the Owner role), `LAST_OWNER`, `OWN_DELIVERIES_ONLY` (courier touching an order that is not theirs), `VISITOR_NOT_IDENTIFIED` (visitor routes needing a lead). The dashboard renders **"Sem acesso"** for a 403 on page load and hides the actions the member cannot perform (use `/auth/me` permissions).

### 1.4 Permission sections and levels

Section keys (exact): `inicio, pedidos, receitas, atendimento, catalogo, importar, classes, clientes, conversas, analises, farmacia, equipe, plano` (pharmacy) plus `leads, imoveis, agenda, conhecimento, configuracoes` (real estate / dealership). Levels `none | view | edit` (`edit` implies `view`). `GET /auth/me` returns all keys (inapplicable ones `none`).

Starter grids (pharmacy; `NICHE_SECTIONS.farmacia`); identical to the prototype matrix; stored per business in `Role.permissions`:

| Section | Owner | Pharmacist (RT, CRF) | Manager | Attendant | Courier |
| --- | --- | --- | --- | --- | --- |
| inicio | view | view | view | view | none |
| pedidos (incl. entregas) | edit | edit | edit | edit | edit, **own deliveries only** |
| receitas (tab in Pedidos) | view | **edit** (CRF) | view | view | none |
| atendimento | view | **edit** (CRF) | view | none | none |
| catalogo | edit | edit | edit | view | none |
| importar | edit | edit | edit | none | none |
| classes | view | **edit** (CRF) | none | none | none |
| clientes | edit | view | edit | view | none |
| conversas | view | view | view | view | none |
| analises | view | view | view | none | none |
| farmacia | edit | view | edit | none | none |
| equipe | edit | none | edit | none | none |
| plano | edit | none | edit | none | none |

Rules (enforced server-side; helpers in `team-rules.ts`): ≥1 active Owner always; the last Owner cannot be removed/disabled/downgraded (`LAST_OWNER`); a Manager cannot edit/disable/remove an Owner nor grant the Owner role (`OWNER_PROTECTED`); confirming classes, validating prescriptions and answering handoffs need `@RequireCrf()`; a role with `requiresCrf` needs a CRF on the member before the member is `active`; new invites default to the starter **Attendant** role; the Owner role is immutable (always the canonical grid); starter roles cannot be edited/deleted (duplicate them); roles with edit on `receitas/atendimento/classes` must have `requiresCrf` (`validateRoleDefinition`); a member cannot change their own role; order and handoff notifications cannot be disabled.

Custom role editor: `GET /team/roles/permission-sections` (below) drives the grid (13 rows in the prototype, with notes and locks).

---

## 2. Enums and state machines

```
Niche            imobiliaria | concessionaria | farmacia
ProductClass     unclassified | otc | prescription | controlled        (default unclassified)
OrderStatus      pending_pharmacist | confirmed | out_for_delivery | ready_for_pickup | delivered | canceled | rejected
Fulfillment      delivery | pickup
CatalogImportStatus  uploaded | mapped | reviewing | applied | failed
PrescriptionStatus   pending | approved | rejected
HandoffReason    symptom | rx | controlled | out_of_stock | other
HandoffStatus    open | answered | closed
MemberStatus     invited | active | disabled
MessageKind      standard | human_joined         (Message.role stays "visitor"|"assistant"|"owner"|"system")
```

UI label maps (pt-BR) every consumer must share (put them in a small module per app):

- Class: `otc` "Venda livre" (badge green), `prescription` "Receita" (amber), `controlled` "Controlado" (gray), `unclassified` "Sem classe" (red). Confirmed shows "✓" suffix; proposed-only shows no check.
- Order status labels: `pending_pharmacist` "Novo" (blue), `confirmed` "Confirmado" (soft), `out_for_delivery` "Em entrega" (amber), `ready_for_pickup` "Pronto p/ retirada" (amber), `delivered` "Concluído" (green), `canceled` "Cancelado" (gray), `rejected` "Recusado" (red).
- Order tabs (UI filter keys): `new` = `pending_pharmacist`; `confirmed` = `confirmed`; `out` = `out_for_delivery` + `ready_for_pickup`; `done` = `delivered`; `canceled` = `canceled` + `rejected`.
- Prescription: `pending` "Aguardando" (amber), `approved` "Aprovada" (green), `rejected` "Recusada" (red).
- Handoff reason labels: `symptom` "Sintoma", `controlled` "Medicamento controlado", `out_of_stock` "Sem estoque", `rx` "Receita", `other` "Outro". Tag: urgent => "Urgente" (red) regardless of reason; else `controlled` "Controlado" (gray), `out_of_stock` "Sem estoque" (amber), others the reason label.
- Member status: `active` "Ativo" (green), `invited` "Convite pendente" (amber), `disabled` "Desativado" (gray).

### 2.1 Order status machine

```
                        confirm                 out (delivery)            done
 pending_pharmacist ───────────────▶ confirmed ─────────────▶ out_for_delivery ───────▶ delivered
        │  │                            │     out (pickup)                              ▲
        │  │ cancel                     │ ─────────────▶ ready_for_pickup ──────────────┘ done
        │  └──────────────▶ canceled ◀──┘ cancel
        │ prescription rejected (system)
        └──────────────▶ rejected
```

| Action | From | To | Perm | Notes |
| --- | --- | --- | --- | --- |
| *(create from chat)* | n/a | `confirmed` with `autoConfirmed = true` when ALL auto-confirm rules pass (HANDOFF 5.5), else `pending_pharmacist` | system | Rx orders (`hasPrescription`) are **never** auto-confirmed. Controlled/unclassified never enter an order. |
| `confirm` | `pending_pharmacist` | `confirmed` | `pedidos:edit` | `409 RX_PENDING` while the order has a `pending` or `rejected` prescription. `confirmedAt` set. |
| `out` | `confirmed` | `out_for_delivery` (delivery) / `ready_for_pickup` (pickup) | `pedidos:edit` | Button label "Saiu para entrega" / "Pronto para retirada". |
| `done` | `out_for_delivery`, `ready_for_pickup` | `delivered` | `pedidos:edit` (courier: only own assigned order) | `deliveredAt` set; starts prescription retention clock. |
| `cancel` | `pending_pharmacist`, `confirmed` | `canceled` | `pedidos:edit` | requires `reasonCode`; `canceledAt`; notifies customer; starts retention clock. |
| *(system)* prescription rejected | `pending_pharmacist` | `rejected` | `receitas:edit`+CRF via reject endpoint | `statusReason` = the reject reason. Terminal. |

Any other transition => `409 INVALID_TRANSITION` with `{ from, action, allowed: [...] }`. Every transition writes an `OrderStatusEvent` (timeline + public status page), an access-log entry (`order.confirm|out|done|cancel`), a customer-facing update (status page; email stub), and never contains health data.

Cancel reasons (`reasonCode`): `out_of_stock` "Sem estoque", `outside_area` "Endereço fora da área de entrega", `customer_request` "Cliente pediu o cancelamento", `other` "Outro motivo" (`note` required). `statusReason` stores the label (+ `: note`).

### 2.2 Prescription status machine

`pending → approved` (pharmacist, CRF) or `pending → rejected` (pharmacist, CRF, `reason` required; cascades the order to `rejected`). Terminal both ways. File retention: `retentionDeleteAt = max(closedAt, reviewedAt) + PharmacySettings.prescriptionRetentionDays` once the order is closed (delivered/canceled/rejected); until then a safety cap of 90 days after upload. The worker purge job deletes the file, sets `fileDeletedAt`, keeps the row (status, code, reviewer) so history stays.

### 2.3 Handoff status machine

`open → answered` (pharmacist reply, CRF) `→ closed` (any `atendimento:edit` + CRF closes; `answered` can be re-opened implicitly by a new customer message: set `open` again). Urgent (`urgent = true`) handoffs sort first. `open → closed` allowed (dismiss).

---

## 3. Auth, session, me

| Method + path | Perm | Status | Request | Response |
| --- | --- | --- | --- | --- |
| `POST /auth/business/verify` | public (rate limited) | FOUNDATION (existing) | `{ idToken }` (Firebase phone) | `{ business, isNew }`; sets cookie. Now creates starter roles + Owner member and issues a member-aware session. |
| `POST /auth/member/login` | public (rate limited) | FOUNDATION | `{ email, password, businessSlug? }` | the **Me** payload below; sets cookie. 401 generic on any failure. `409 BUSINESS_AMBIGUOUS` + `businesses:[{slug,name}]` when the same email+password exists in several businesses. |
| `POST /auth/business/logout` | any | FOUNDATION (existing) | none | `{ ok: true }` (clears cookie) |
| `GET /auth/me` | any member | FOUNDATION | none | **Me** |
| `PUT /auth/me/credentials` | any member | FOUNDATION | `{ email, password, currentPassword? }` (`currentPassword` required if a password exists; password ≥ 8 chars) | `{ ok: true }`; `409 EMAIL_IN_USE`. Lets phone-login owners add email login. |
| `POST /auth/member/forgot-password` | public | 2b | `{ email, businessSlug? }` | `{ ok: true }` always (no enumeration). Creates a `MemberInvite` row with `kind="password_reset"` (1h expiry, token hash) and emails `dashboardLink("/imobiliaria/app/redefinir-senha?token=<token>")` (stub logs the link without `RESEND_API_KEY`). |
| `POST /auth/member/reset-password` | public | 2b | `{ token, password }` | **Me** + cookie; marks token used. |

**Me payload** (`GET /auth/me`, login responses):

```json
{
  "member": { "id": "…", "name": "Paulo Nunes", "email": "paulo@farmacia.com.br", "crf": "CRF-PR 1234" },
  "role": { "id": "…", "key": "pharmacist", "name": "Farmacêutico RT", "requiresCrf": true, "ownDeliveriesOnly": false },
  "permissions": { "inicio": "view", "pedidos": "edit", "receitas": "edit", "atendimento": "edit", "catalogo": "edit",
                   "importar": "edit", "classes": "edit", "clientes": "view", "conversas": "view", "analises": "view",
                   "farmacia": "view", "equipe": "none", "plano": "none",
                   "leads": "none", "imoveis": "none", "agenda": "none", "conhecimento": "none", "configuracoes": "none" },
  "visibleSections": ["inicio", "pedidos", "receitas", "atendimento", "..."],
  "canPerformPharmacistActions": true,
  "business": { "id": "…", "name": "Farmácia Exemplo", "slug": "farmacia-exemplo", "niche": "farmacia", "status": "live",
                "logoUrl": null,
                "branding": { "primaryColor": "#0F766E", "secondaryColor": "#0B4F4A", "tertiaryColor": "#F59E0B" },
                "brandingIsCustom": false }
}
```

`role.key` is `null` for custom roles. `key = "owner"` always has the canonical full grid. The dashboard sidebar shows exactly `visibleSections` (+ "Assistente" when `permissions.farmacia` is `edit` or `permissions.configuracoes` is `edit`, i.e. owner/manager; the interview needs `farmacia:edit`). Direct URL without access renders **"Sem acesso"** (`/sem-acesso`), API 403.

### 3.1 Dashboard route map (for hrefs in insights/notifications)

`/inicio`, `/pedidos` (tabs `?tab=pedidos|receitas`), `/atendimento`, `/catalogo`, `/catalogo/importar`, `/catalogo/classes`, `/clientes`, `/conversas`, `/analises`, `/farmacia` (tabs `?tab=identidade|entrega|retirada|limites|estoque|horarios|aparencia`), `/equipe` (tabs `?tab=membros|funcoes|registro`), `/plano`, `/assistente`, `/login`, `/convite/[token]`, `/redefinir-senha`, `/sem-acesso`. (All under the dashboard basePath.)

---

## 4. Team and access (`equipe`)

| Method + path | Perm | Status | Request | Response |
| --- | --- | --- | --- | --- |
| `GET /team/members` | `equipe:view` | 2b | `?status=&q=` | `{ items: Member[], counts: { active, invited, disabled } }` |
| `POST /team/members/invite` | `equipe:edit` | 2b | `{ email, name?, roleId? }` (`roleId` default = starter attendant) | `201 { member: Member, inviteUrl? }` (`inviteUrl` only when email delivery is not configured, i.e. dev). Creates `BusinessMember(status=invited)` + `MemberInvite(kind=invite, 7d)`, emails the link built with `dashboardLink("/imobiliaria/app/convite/<token>")` (`apps/api/src/common/email-links.ts`; `DASHBOARD_URL` has no basePath). Rules: `assertCanGrantRole`. `409 EMAIL_IN_USE`. Log `team.invite`. |
| `POST /team/members/:id/resend-invite` | `equipe:edit` | 2b | none | `{ ok: true }` (new token, old invalidated). Log `team.invite_resend`. |
| `PATCH /team/members/:id` | `equipe:edit` | 2b | `{ name?, roleId?, crf? }` | `Member`. Rules: `assertCanModifyMember`, `assertCanGrantRole`, `assertNotLastOwner(role)`, `assertCrfForRole`; `400 CANNOT_CHANGE_OWN_ROLE`. Log `team.role_change` (summary "Alterou Bruno Dias de Entregador para Atendente"). |
| `POST /team/members/:id/disable` | `equipe:edit` | 2b | none | `Member`. `assertCanModifyMember` + `assertNotLastOwner(disable)`. Instant (guard re-checks status on each request). Log `team.disable`. |
| `POST /team/members/:id/enable` | `equipe:edit` | 2b | none | `Member`. Log `team.enable`. |
| `DELETE /team/members/:id` | `equipe:edit` | 2b | none | `{ ok: true }` only for `invited` members; others `409 MEMBER_HAS_HISTORY` (use disable). |
| `GET /team/invites/:token` | public | 2b | none | `{ business: { name, logoUrl, branding }, email, name?, role: { name, description, requiresCrf }, expiresAt }`. `404` expired/used/unknown. |
| `POST /team/invites/accept` | public (rate limited) | 2b | `{ token, name, password, crf?, acceptTerms: true }` | **Me** + sets cookie. CRF required if the role `requiresCrf` (`CRF_REQUIRED_FOR_ROLE`). Sets `status=active`, `acceptedAt`. Log `team.invite_accept`. |
| `GET /team/roles` | `equipe:view` | 2b | none | `{ items: Role[] }` |
| `GET /team/roles/permission-sections` | `equipe:view` | 2b | none | `{ sections: [{ key, label, note?, crfOnly: boolean, readOnly: boolean }] }` for this business's niche (labels from `SECTION_LABELS`; notes from the prototype, e.g. receitas "Validar exige CRF", clientes "Dados de saúde ficam ocultos", conversas "Somente leitura", farmacia "Identidade legal só para proprietário", equipe "Gerente não altera proprietários"). |
| `POST /team/roles` | `equipe:edit` | 2b | `{ name, description?, requiresCrf: boolean, permissions: { [section]: "none"\|"view"\|"edit" }, ownDeliveriesOnly?: boolean }` | `201 Role`. Validate with `validateRoleDefinition`. Log `role.create`. |
| `PATCH /team/roles/:id` | `equipe:edit` | 2b | same fields, all optional | `Role`. `assertRoleEditable` (starter/owner roles are not editable). Log `role.update`. |
| `DELETE /team/roles/:id` | `equipe:edit` | 2b | none | `{ ok: true }`; `409 ROLE_IN_USE` if members use it; starter roles `400 STARTER_ROLE`. Log `role.delete`. |
| `GET /team/access-log` | `equipe:view` + role key `owner` or `manager` (check `member.roleKey`; other custom roles with `equipe:view` get 403) | 2b | `?memberId=&category=&from=&to=&limit=&cursor=` | `{ items: LogEntry[], nextCursor }` using `AccessLogService.list` |

```jsonc
// Member
{ "id": "…", "name": "Paulo Nunes", "email": "paulo@x.com", "initials": "PN", "crf": "CRF-PR 1234",
  "status": "active", "statusLabel": "Ativo",
  "role": { "id": "…", "key": "pharmacist", "name": "Farmacêutico RT", "isStarter": true },
  "lastAccessAt": "2026-10-13T12:00:00Z",            // null => "nunca"
  "invitedAt": "…", "locked": false }                // locked = the protected primary Owner row (UI hides the edit action)

// Role
{ "id": "…", "key": "attendant", "name": "Atendente", "description": "…", "isStarter": true, "requiresCrf": false,
  "ownDeliveriesOnly": false, "permissions": { /* all section keys */ }, "memberCount": 3 }

// LogEntry (one row of "Registro de acessos")
{ "id": "…", "createdAt": "…", "memberId": "…", "memberName": "Paulo Nunes",
  "action": "prescription.approve", "category": "Receita", "target": "RX-309",
  "summary": "Aprovou RX-309 do pedido PED-4809" }
```

Access-log action codes (use exactly; `category` is derived by prefix): `auth.login, auth.credentials_set, team.invite, team.invite_resend, team.invite_accept, team.role_change, team.disable, team.enable, team.remove, role.create, role.update, role.delete, prescription.approve, prescription.reject, prescription.download, handoff.answer, handoff.close, class.confirm, catalog.import, catalog.product_update, order.confirm, order.out, order.done, order.cancel, order.assign_courier, settings.update, branding.update, billing.change`. Categories: Receita, Atendimento, Pedido, Equipe, Catálogo, Configurações, Plano, Acesso, Outros. Pass `summary` (one pt-BR sentence, no health data). `record()` never throws.

---

## 5. Branding and pharmacy settings

### 5.1 Branding (`farmacia` for pharmacy, `configuracoes` for sales niches)

| Method + path | Perm | Status | Request | Response |
| --- | --- | --- | --- | --- |
| `GET /businesses/me/branding` | `farmacia:view` or `configuracoes:view` | FOUNDATION | none | `{ logoUrl, primaryColor, secondaryColor, tertiaryColor, stored: { primaryColor, secondaryColor, tertiaryColor }, isCustom }` (top-level colours are always resolved, default teal for pharmacy) |
| `PUT /businesses/me/branding` (alias `PATCH`) | `farmacia:edit` or `configuracoes:edit` | FOUNDATION | `{ primaryColor?, secondaryColor?, tertiaryColor?, logoUrl? }`; colours `#RRGGBB` or `null` (reset to default); `logoUrl` http(s) URL or `/path` or `null` | same as GET. Log `branding.update` (2b: add the log call in the service). |
| `POST /businesses/me/branding/logo` | `farmacia:edit` | 2b | multipart `file` (png/jpeg/webp/svg ≤ 1 MB) | `{ logoUrl }` (served by `GET /public/businesses/:businessId/logo`) |
| `GET /businesses/public/:slug` | public | FOUNDATION (extended) | none | existing fields plus `branding: { primaryColor, secondaryColor, tertiaryColor }` (always resolved), `persona: { name, isAi: true }`, `pharmacy: null \| { legalName, cnpj, pharmacistName, pharmacistCrf, deliveryEnabled, pickupEnabled, deliveryFeeCents, minOrderCents, paymentMethods, openingHours, quickChips }` |

Dashboard applies `branding` as CSS variables (`--brand-primary`, `--brand-secondary`, `--brand-tertiary`), chat widget and status page the same; default teal `#0F766E / #0B4F4A / #F59E0B` when unset.

### 5.2 Pharmacy settings (`farmacia`)

| Method + path | Perm | Status | Request | Response |
| --- | --- | --- | --- | --- |
| `GET /pharmacy/settings` | `farmacia:view` | 2b | none | `PharmacySettingsDto` (create-on-read with defaults) |
| `PUT /pharmacy/settings` | `farmacia:edit` | 2b | partial `settings` (below) | `PharmacySettingsDto`. Identity fields (`legalName, cnpj, afeNumber, pharmacistName, pharmacistCrf`) may only be changed by role key `owner` (`403 OWNER_PROTECTED`, "Identidade legal só para proprietário"). Validates CNPJ (14 digits + check digits), ranges. Log `settings.update` with a summary such as "Alterou taxa de entrega para R$ 6,00" (**list changed keys, never PII beyond that**). |
| `POST /pharmacy/settings/proposals/:fieldKey/confirm` | `farmacia:edit` | 2b | optional `{ values: { [settingsKey]: value } }` (owner-edited) | `PharmacySettingsDto`. Applies the proposal into the real columns and marks it `confirmed`. |
| `POST /pharmacy/settings/proposals/:fieldKey/dismiss` | `farmacia:edit` | 2b | none | `PharmacySettingsDto` |

How proposals are created: whenever the onboarding interview stores a field of the `farmacia` template (`POST /onboarding/profile/field`, or the interview extraction), 2b maps it with `farmaciaSettingsFieldMap` (`packages/profile-schema`) and writes `PharmacySettings.proposals[fieldKey]` with best-effort deterministic parsing (money via `parseBrazilianPrice`, booleans, hours, districts); anything unparsable keeps `proposed: {}` and shows the raw answer so the owner types it. **Nothing is applied until the owner confirms.**

```jsonc
// PharmacySettingsDto
{
  "settings": {
    "legalName": "Farmácia Exemplo Ltda.", "cnpj": "12345678000190", "afeNumber": "…", "pharmacistName": "Maria Souza", "pharmacistCrf": "CRF-PR 1234",
    "deliveryEnabled": true, "deliveryFeeCents": 600, "minOrderCents": 1500,
    "deliveryAreas": [ { "type": "district", "value": "Água Verde" }, { "type": "cep_prefix", "value": "80250" } ],
    "pickupEnabled": true,
    "maxQtyPerItemDefault": 5,                       // per-product maxQtyPerOrder overrides
    "autoConfirmEnabled": true, "stockMaxAgeHours": 24,
    "openingHours": [ { "key": "weekdays", "label": "Segunda a sexta", "open": true, "from": "08:00", "to": "20:00" },
                      { "key": "saturday", "label": "Sábado", "open": true, "from": "08:00", "to": "18:00" },
                      { "key": "sunday", "label": "Domingo e feriados", "open": false } ],
    "paymentMethods": ["pix", "cartao", "dinheiro"],  // on delivery / pickup; payment is always "on_delivery" in v1
    "exchangePolicy": null,
    "prescriptionRetentionDays": 30, "orderReminderMinutes": 10,
    "quickChips": ["Fazer um pedido", "Falar com o farmacêutico", "Horários e entrega"]
  },
  "proposals": {                                       // pending first; the UI marks these fields "confirmar"
    "taxa_entrega": { "fieldKey": "taxa_entrega", "label": "Taxa de entrega", "rawAnswer": "R$ 6,00", "proposed": { "deliveryFeeCents": 600 },
                      "status": "pending", "proposedAt": "…", "confirmedAt": null }
  },
  "sheet": { "stockAsOf": "2026-10-13T14:00:00Z", "ageHours": 5, "maxAgeHours": 24, "stale": false },   // from the latest applied catalog import
  "banner": "Notificações de pedidos estão sempre ativas."                                              // static copy, shown on the Farmácia page
}
```

All the settings above exist as columns of `PharmacySettings` (plus `proposals`, `nextOrderNumber`, `nextRxNumber`). One interview answer is NOT a column: `pharmacistRequiredProductNames` ("produtos que sempre exigem farmacêutico"). 2b matches those names against the catalog and, on confirm, sets `pharmacistRequired = true` on the matching products (show the matched list so the owner confirms it).

---

## 6. Catalog (`catalogo`, `importar`, `classes`)

### 6.1 Products

| Method + path | Perm | Status | Request | Response |
| --- | --- | --- | --- | --- |
| `GET /products` | `catalogo:view` | 2b | `?class=all\|unclassified\|otc\|prescription\|controlled&stock=out&q=&equivalentGroup=&active=&limit=&cursor=` (`class` default all; `stock=out` = `stockQty = 0`; `q` matches name/ingredient/EAN) | `{ items: ProductDto[], counts: { all, unclassified, prescription, controlled, otc, outOfStock }, nextCursor }` (counts ignore `class`/`stock` filters) |
| `GET /products/:id` | `catalogo:view` | 2b | none | `ProductDto` + `equivalents` |
| `POST /products` | `catalogo:edit` | 2b | `{ name, priceCents, presentation?, manufacturer?, ean?, sku?, activeIngredient?, category?, stockQty?, maxQtyPerOrder?, pharmacistRequired?, equivalentGroup? }` | `201 ProductDto` (always `saleClass = unclassified`). `dedupKey` = EAN or normalized name+presentation; `409 PRODUCT_EXISTS`. Log `catalog.product_update`. |
| `PATCH /products/:id` | `catalogo:edit` | 2b | any of `name, presentation, manufacturer, ean, sku, activeIngredient, category, priceCents, stockQty, pharmacistRequired, maxQtyPerOrder, equivalentGroup, active` | `ProductDto`. Marks the field in `overriddenFields` so re-imports do not overwrite it. **`saleClass` is rejected here** (`400 USE_CLASS_ENDPOINT`). Stock edits set `stockAsOf = now` for that row. |
| `POST /products/:id/class` | `classes:edit` + CRF | 2b | `{ saleClass: "otc"\|"prescription"\|"controlled"\|"unclassified" }` | `ProductDto` (`classConfirmedAt/By` set; `unclassified` clears confirmation). Log `class.confirm` ("Classificou Dipirona 500 mg como Venda livre"). |
| `POST /products/:id/image` | `catalogo:edit` | 2b | multipart `file` (jpeg/png/webp ≤ 2 MB) | `{ imageUrl }`. Stored under `LOCAL_STORAGE_DIR/products/<businessId>/<uuid>.<ext>`, `imageKey` saved. |
| `DELETE /products/:id/image` | `catalogo:edit` | 2b | none | `{ ok: true }` (placeholder icon again) |
| `GET /public/products/:id/image` | public | 2b | none | image bytes (`Cache-Control: public, max-age=3600`); only for active products of `live` businesses; 404 otherwise. Product images are not sensitive; this is the only way they are served (the storage dir is never exposed statically). |

```jsonc
// ProductDto
{ "id": "…", "name": "Dipirona 500 mg", "presentation": "10 comprimidos", "manufacturer": "EMS",
  "subtitle": "10 comprimidos · EMS",                       // "presentation · manufacturer", what the table shows under the name
  "ean": "7891234567890", "sku": null, "activeIngredient": "dipirona", "category": null,
  "priceCents": 890, "stockQty": 42, "stockAsOf": "…",
  "saleClass": "otc", "classLabel": "Venda livre ✓", "classBadge": "green",   // badge: green|amber|gray|red
  "classProposed": "otc", "classProposedBy": "sheet", "classProposedReason": "coluna \"Tarja\"",
  "classConfirmedAt": "…", "classConfirmedByName": "Paulo Nunes",
  "needsReview": false,                                      // class proposed by a re-import differs from the confirmed class
  "pharmacistRequired": false, "maxQtyPerOrder": 5,
  "equivalentGroup": "grupo A", "equivalents": [ { "id": "…", "name": "Novalgina 500 mg", "stockQty": 18, "priceCents": 1290 } ],
  "imageUrl": "/api/public/products/<id>/image?v=1728820000" /* or null */, "placeholderIcon": "pill",   // pill | bottle | box by presentation
  "orderable": true,                                         // saleClass=otc && confirmed && !pharmacistRequired && active && stockQty>0
  "warning": "",                                             // pt-BR hint shown in the sheet by class (prototype copy)
  "active": true, "updatedAt": "…" }
```

`warning` copy: prescription "Exige receita. O pedido sempre passa pelo farmacêutico."; controlled "Controlado. O chat só informa disponibilidade e preço, nunca vende."; unclassified "Sem classe. Não pode ser vendido no chat até ser revisado.". **Hard rules (code, never the model):** `controlled` and `unclassified` can never enter a cart/order; `prescription` only with an attached prescription upload and always `pending_pharmacist`; only `saleClass = otc` with `classConfirmedAt` set is orderable.

### 6.2 Catalog import (`importar`)

Pipeline: upload → worker maps columns with ONE model call (≈20 sample rows; with the model down it falls back to header-keyword heuristics and marks every column `confidence: "low"`) → owner confirms/edits the mapping → dry-run summary → apply (deterministic; price parsing via `parseBrazilianPrice`; dedupe by EAN, else normalized name+presentation). Imported products are created/updated with `saleClass = unclassified` and `classProposed*` filled (order: explicit class column, then versioned regulatory reference list, then model, else none); a confirmed class is never downgraded silently (a differing proposal sets `needsReview`).

| Method + path | Perm | Status | Request | Response |
| --- | --- | --- | --- | --- |
| `POST /catalog-imports` | `importar:edit` | 2b | multipart `file` (xlsx / xls / csv ≤ 20 MB; stored via the KnowledgeDocument-style local storage under `catalog/<businessId>/…`, NOT chunked/embedded) | `201 ImportDto` (`status: "uploaded"`); enqueues worker job `catalog-import:map` |
| `GET /catalog-imports` | `importar:view` | 2b | `?limit=` | `{ items: ImportSummary[] }` history (step "Histórico de importações") |
| `GET /catalog-imports/:id` | `importar:view` | 2b | none | `ImportDto` (poll every 2 s until `status != "uploaded"`) |
| `POST /catalog-imports/:id/mapping` | `importar:edit` | 2b | `{ headerRow?: number, columns: [{ sourceColumn: string, field: ImportField }] }` | `ImportDto` with `status: "reviewing"` and `dryRun`. |
| `GET /catalog-imports/:id/class-proposals` | `importar:view` | 2b | none | `{ groups: [{ key: "controlled"\|"prescription"\|"otc"\|"unclassified", label, count, hint, samples: [{ name, by }] }] }` (step 3, informational) |
| `POST /catalog-imports/:id/apply` | `importar:edit` | 2b | `{ stockAsOf: ISO, stockUpToDateConfirmed: true }` (400 if false/missing: the owner must state the sheet is up to date as of that time) | `ImportDto` (`status: "applied"`, `stats`). Small files apply synchronously; large ones return `202` + `status: "reviewing"` and the worker finishes (poll `GET`). Sets `stockAsOf` on every touched product. Log `catalog.import` ("Importou estoque_farmacia_out.xlsx"). |

```jsonc
// ImportField = "name" | "price" | "stock" | "ean" | "sku" | "activeIngredient" | "presentation" | "manufacturer" | "category" | "class" | "equivalentGroup" | "ignore"
// ImportDto
{ "id": "…", "filename": "estoque_farmacia_out.xlsx", "status": "uploaded|mapped|reviewing|applied|failed", "error": null,
  "createdAt": "…", "appliedAt": null, "stockAsOf": null,
  "sheetName": "Plan1", "headerRow": 1, "rowCount": 2400,
  "mapping": { "columns": [ { "sourceColumn": "Produto", "example": "DIPIRONA 500MG C/10", "field": "name", "confidence": "high", "confidenceScore": 0.97 },
                            { "sourceColumn": "Qtd", "example": "42", "field": "stock", "confidence": "medium", "confidenceScore": 0.62 } ],
               "unmapped": ["Obs"], "modelUsed": true },                 // modelUsed=false => heuristic fallback
  "previewRows": [ { "Produto": "DIPIRONA 500MG C/10", "Vlr Venda": "8,90", "Qtd": "42" } ],   // first 5 rows, raw
  "dryRun": { "rows": 2400, "toCreate": 2100, "toUpdate": 280, "skipped": 20, "classSummary": { "controlled": 12, "prescription": 96, "otc": 310, "unclassified": 148 } },
  "stats": { "rows": 2400, "created": 2100, "updated": 280, "skipped": 20, "unclassified": 148, "rejected": 0 },
  "createdByName": "Renata Alves" }
// ImportSummary = { id, filename, status, createdAt, appliedAt, stockAsOf, stats, createdByName }
```

Worker: BullMQ queue `catalog-import` (new file in `apps/worker/src/processors/`, calls the API via `callInternalApi` to `POST /internal/businesses/:businessId/catalog-imports/:id/map`). A required `field` set for apply is `name` + `price`; otherwise `409 MAPPING_INCOMPLETE`.

### 6.3 Class review (`classes`; "Revisar classes")

| Method + path | Perm | Status | Request | Response |
| --- | --- | --- | --- | --- |
| `GET /catalog/class-review` | `classes:view` | 2b | none | `{ progress: { confirmed, total, percent }, groups: [ClassGroup] }` |
| `GET /catalog/class-review/groups/:key/products` | `classes:view` | 2b | `?limit=&cursor=` (`key` = `controlled\|prescription\|otc\|unclassified`) | `{ items: [{ id, name, subtitle, by, classProposed, needsReview }], nextCursor }` |
| `POST /catalog/class-review/groups/:key/confirm` | `classes:edit` + CRF | 2b | none | `{ confirmed: number }`. Confirms every product whose `classProposed = key` and not yet confirmed (`400` for `unclassified`). Log `class.confirm`. |
| `POST /products/:id/class` | `classes:edit` + CRF | 2b | see 6.1 | one-by-one confirm / manual class (also used by "Revisar um a um") |

```jsonc
// ClassGroup
{ "key": "controlled", "title": "Controlados propostos", "short": "Controlado", "badge": "gray",
  "hint": "Revise um a um. Esses produtos nunca podem ser comprados online.",
  "count": 12, "confirmedCount": 0, "done": false, "canConfirm": true,
  "samples": [ { "id": "…", "name": "Clonazepam 2 mg", "by": "lista Portaria 344" } ] }
```

Group order: controlled, prescription, otc, unclassified (`unclassified` titled "Incertos", `canConfirm: false`, hint "Ficam sem classe e não podem ser vendidos no chat até você decidir."). `by` text examples: `coluna "Tarja"`, `referência ANVISA`, `lista Portaria 344`, `IA`, `IA, baixa confiança`. `progress.total` = products with a proposal other than `unclassified`.

---

## 7. Orders, prescriptions, handoffs

### 7.1 Orders (`pedidos`; courier scoped to own deliveries)

| Method + path | Perm | Status | Request | Response |
| --- | --- | --- | --- | --- |
| `GET /orders` | `pedidos:view` | 2b | `?status=new\|confirmed\|out\|done\|canceled&fulfillment=delivery\|pickup&q=&limit=&cursor=` (UI tab keys, section 2) | `{ items: OrderListDto[], counts: { new, confirmed, out, done, canceled }, nextCursor }` (counts ignore `status`, respect courier scoping) |
| `GET /orders/:id` | `pedidos:view` | 2b | none | `OrderDetailDto` |
| `POST /orders/:id/confirm` | `pedidos:edit` | 2b | none | `OrderDetailDto` |
| `POST /orders/:id/out` | `pedidos:edit` | 2b | none | `OrderDetailDto` (delivery => `out_for_delivery`, pickup => `ready_for_pickup`) |
| `POST /orders/:id/done` | `pedidos:edit` | 2b | none | `OrderDetailDto` (courier role: only if `courierMemberId = me`, else `403 OWN_DELIVERIES_ONLY`) |
| `POST /orders/:id/cancel` | `pedidos:edit` | 2b | `{ reasonCode: "out_of_stock"\|"outside_area"\|"customer_request"\|"other", note? }` | `OrderDetailDto` |
| `PUT /orders/:id/courier` | `pedidos:edit` (not for ownDeliveriesOnly roles) | 2b | `{ memberId: string \| null }` (active member whose role has `ownDeliveriesOnly`) | `OrderDetailDto`. Log `order.assign_courier`. |
| `GET /orders/couriers` | `pedidos:view` | 2b | none | `{ items: [{ id, name }] }` (active members with an `ownDeliveriesOnly` role) |

```jsonc
// OrderListDto  (row of the Pedidos table and of "Pedidos que exigem ação")
{ "id": "…", "code": "PED-4821",
  "customer": { "id": "…", "name": "João Silva" },
  "itemCount": 1, "totalCents": 1490,
  "fulfillment": "delivery", "kindLabel": "Entrega",         // "Entrega" | "Retirada" | "Receita" (Rx orders show "Receita")
  "hasPrescription": false, "rxPending": false,
  "status": "pending_pharmacist", "statusLabel": "Novo", "statusBadge": "blue", "tab": "new",
  "autoConfirmed": false, "originLabel": "Chat",             // "⚡ automático" when autoConfirmed
  "createdAt": "…", "waitingMinutes": 2,
  "stale": false,                                            // catalog sheet older than stockMaxAgeHours when the order was placed (kindLabel stays; show "Estoque antigo")
  "addressDiffersFromSaved": true, "needsAction": true }

// OrderDetailDto = OrderListDto +
{ "customer": { "id": "…", "name": "João Silva", "phone": "+5541998123344", "phoneFormatted": "(41) 99812-3344", "email": "joao@email.com" },
  "conversationId": "…",                                     // "Abrir conversa" => /conversas?open=<id>
  "address": { "label": "Rua das Flores, 120B, ap 31 · Água Verde, Curitiba/PR · ref: portão azul", "cep": "80250000", "street": "…", "number": "120B",
               "complement": "ap 31", "reference": "portão azul", "district": "Água Verde", "city": "Curitiba", "state": "PR" },   // null for pickup. Full number: staff need it.
  "addressDiffersFromSaved": true,                           // renders "⚠ difere do salvo"
  "items": [ { "id": "…", "productId": "…", "name": "Dipirona 500 mg · 10 comp.", "qty": 1, "unitPriceCents": 890, "lineTotalCents": 890,
               "saleClass": "otc", "classLabel": "OTC", "classBadge": "green" } ],
  "subtotalCents": 890, "deliveryFeeCents": 600, "totalCents": 1490,
  "paymentMethod": "on_delivery", "paymentLabel": "na entrega",     // "na retirada" for pickup
  "notes": null,
  "prescriptions": [ { "id": "…", "code": "RX-310", "status": "pending", "statusLabel": "Aguardando" } ],
  "stockSheet": { "asOf": "…", "ageHours": 5, "stale": false },     // "Estoque do catálogo atualizado há 5h"
  "courier": null /* or { "id", "name" } */,
  "statusReason": null,
  "timeline": [ { "status": "pending_pharmacist", "label": "Recebido", "at": "…", "byName": "Cliente" },
                { "status": "confirmed", "label": "Confirmado", "at": "…", "byName": "Sistema" } ],   // from OrderStatusEvent
  "allowedActions": ["confirm", "cancel"],                         // server-computed from status, fulfillment, rxPending, role
  "actionLabels": { "out": "Saiu para entrega" },                  // or "Pronto para retirada"
  "cancelReasons": [ { "code": "out_of_stock", "label": "Sem estoque" }, { "code": "outside_area", "label": "Endereço fora da área de entrega" },
                     { "code": "customer_request", "label": "Cliente pediu o cancelamento" }, { "code": "other", "label": "Outro motivo" } ] }
```

Order creation is NOT a dashboard route: it happens in the chat engine (2a) through `OrdersService.createFromCart(...)` which 2b must export from the orders module for 2a to call (see 8.3). `needsAction` is true for `pending_pharmacist` orders only (waiting for the team to confirm or for a prescription to be validated).

### 7.2 Prescriptions (`receitas`, a tab inside Pedidos)

| Method + path | Perm | Status | Request | Response |
| --- | --- | --- | --- | --- |
| `GET /prescriptions` | `receitas:view` | 2b | `?status=pending\|approved\|rejected&q=&limit=&cursor=` | `{ items: RxListDto[], counts: { pending, approved, rejected }, nextCursor }` |
| `GET /prescriptions/:id` | `receitas:view` | 2b | none | `RxDetailDto` |
| `GET /prescriptions/:id/file` | `receitas:view` | 2b | none | the image/PDF bytes, headers `Cache-Control: private, no-store`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`; **access-checked** (session + permission + same business). `410 PRESCRIPTION_PURGED` after retention. Log `prescription.download` (target RX code). Never a public URL. |
| `POST /prescriptions/:id/approve` | `receitas:edit` + CRF | 2b | none | `RxDetailDto`; only from `pending` (`409` otherwise). Log `prescription.approve` ("Aprovou RX-309 do pedido PED-4809"). |
| `POST /prescriptions/:id/reject` | `receitas:edit` + CRF | 2b | `{ reason: string (3..300) }` | `RxDetailDto`; order => `rejected` (statusReason = reason); customer informed via system message + status page. Log `prescription.reject`. |

```jsonc
// RxListDto (Orders > Receitas tab)
{ "id": "…", "code": "RX-310", "patientName": "Ana Paula Ramos", "med": "Amoxicilina 500 mg · 21 caps.",
  "orderId": "…", "orderCode": "PED-4820", "createdAt": "…", "status": "pending", "statusLabel": "Aguardando", "badge": "amber" }
// RxDetailDto = RxListDto + { "mimeType": "image/jpeg", "fileUrl": "/api/prescriptions/<id>/file", "fileAvailable": true,
//   "reviewedAt": null, "reviewedByName": null, "rejectReason": null, "retentionDeleteAt": "…", "retentionLabel": "Apagada em 12 nov 2026" }
```

Upload (visitor side) is in section 8.4. Uploaded files are stored privately under `LOCAL_STORAGE_DIR/private/prescriptions/<businessId>/<uuid>.<ext>`; the API must never serve that tree statically (today it serves no static files: keep it that way).

### 7.3 Handoffs: "Atendimento farmacêutico" (`atendimento`)

| Method + path | Perm | Status | Request | Response |
| --- | --- | --- | --- | --- |
| `GET /handoffs` | `atendimento:view` | 2b | `?status=open\|answered\|closed&limit=&cursor=` (default `open`; sorted urgent first, then oldest first) | `{ items: HandoffListDto[], counts: { open, answered, urgent }, nextCursor }` |
| `GET /handoffs/:id` | `atendimento:view` | 2b | none | `HandoffDetailDto` |
| `POST /handoffs/:id/reply` | `atendimento:edit` + CRF | 2b | `{ text: string (1..2000) }` | `HandoffDetailDto`. Creates `Message{ role:"owner", content:text, authorMemberId, authorRole: role name, authorName }` in the conversation; if this member has no `human_joined` system message in the conversation yet, first creates `Message{ role:"system", kind:"human_joined", content:"<Nome> · <Função> entrou na conversa", authorMemberId, authorRole, authorName }`; sets `status = answered`, `answerText`, `answeredAt`, `answeredBy*`; sends the visitor push (existing push service) and stores NO brief text in any message. Log `handoff.answer` (summary "Respondeu atendimento" with no content). |
| `POST /handoffs/:id/close` | `atendimento:edit` + CRF | 2b | none | `HandoffDetailDto`. Log `handoff.close`. |

```jsonc
// HandoffListDto
{ "id": "…", "who": "Maria, 34", "customerName": "Maria", "urgent": true,
  "tag": "Urgente", "tagBadge": "red", "reason": "symptom", "reasonLabel": "Sintoma",
  "summary": "Dor de cabeça há 3 dias", "status": "open", "createdAt": "…", "waitingMinutes": 4, "conversationId": "…" }

// HandoffDetailDto = HandoffListDto +
{ "brief": { /* raw JSON stored by the chat engine, see below */ },
  "briefRows": [ { "label": "Sintoma", "value": "Dor de cabeça forte" }, { "label": "Duração", "value": "Há 3 dias" },
                 { "label": "Intensidade", "value": "Forte, piora à noite" }, { "label": "Para quem", "value": "Ela mesma, 34 anos" },
                 { "label": "Gestante", "value": "Não" }, { "label": "Alergias", "value": "Dipirona" },
                 { "label": "Outros remédios", "value": "Losartana" }, { "label": "Já tentou", "value": "Ibuprofeno sem melhora" } ],
  "suggestion": { "label": "Sugestão para o farmacêutico, não enviada ao cliente",
                  "text": "Paracetamol 750 mg · em estoque · R$ 11,20. Ela tem alergia a dipirona.",
                  "products": [ { "productId": "…", "name": "Paracetamol 750 mg", "reason": "…", "inStock": true, "priceCents": 1120 } ] } /* or null */,
  "conversationLink": "/conversas?open=<conversationId>",
  "answer": null /* or { "text", "at", "byName", "byRole" } */ }
```

`brief` (JSON written by 2a in `PharmacistHandoff.brief`, **never** written to any `Message`): `{ symptoms, duration, severity, forWhom: { relation, age, pregnant? }, allergies: string[], otherMedicines: string[], alreadyTried: string[], redFlags: string[], suggestedProducts: [{ productId, name, reason, inStock, priceCents }], medication?, availability?, priceInformedCents?, onlineSaleAllowed?, customerRequest? }` (controlled / out-of-stock handoffs use the second group of keys: the prototype rows "Medicamento", "Disponibilidade", "Preço informado", "Venda online", "Pedido do cliente", "Produto pedido", "Estoque", "Equivalentes"). 2b builds `briefRows` from whichever keys exist, in this order with these pt-BR labels. `suggestion.products` must come only from in-stock catalog rows; equivalents shown only when flagged `equivalentGroup`.

### 7.4 Customers (`clientes`)

| Method + path | Perm | Status | Request | Response |
| --- | --- | --- | --- | --- |
| `GET /customers` | `clientes:view` | 2b | `?q=&limit=&cursor=` (name / phone / email) | `{ items: CustomerListDto[], nextCursor, total }` |
| `GET /customers/:id` | `clientes:view` | 2b | none | `CustomerDetailDto` |

```jsonc
// CustomerListDto
{ "id": "…", "name": "João Silva", "initials": "JS", "phone": "+5541998123344", "phoneFormatted": "(41) 99812-3344", "email": "joao@email.com",
  "ordersCount": 7, "lastActivityAt": "…", "addressLabel": "Rua das Flores, nº •••, Água Verde" /* masked default, or "Retirada em loja" when only pickup orders */ }
// CustomerDetailDto = CustomerListDto + { "consent": { "grantedAt": "…", "purposes": ["atendimento"], "version": "2026-02" } | null,
//   "addresses": [ { ...MaskedAddress, "createdAt": "…", "supersededAt": null } ],      // history kept, masked
//   "orders": [ { "id": "…", "code": "PED-4821", "createdAt": "…", "totalCents": 1490, "status": "pending_pharmacist", "statusLabel": "Novo" } ] }
```

No health data (symptoms, handoff briefs, prescriptions) in customer views.

---

## 8. Chat (public/visitor) endpoints and UI payloads

Existing visitor chat endpoints stay (`POST /chat/:businessId/conversations`, `GET .../messages`, `POST .../messages`, `POST .../messages/stream`, ...). For `niche = farmacia` they gain the **pharmacy payloads** below (additive; real-estate/dealership responses are unchanged).

### 8.1 Message payload additions

Each assistant/system/owner message in `GET .../messages`, `POST .../messages` (`message`) and the `done` SSE event carries (additive):

```jsonc
{ "id": "…", "role": "assistant", "content": "Encontrei:", "createdAt": "…",
  "kind": "standard",                                   // "human_joined" for the join banner (role "system")
  "author": null,                                       // set for people: { "memberId": "…", "name": "Maria Souza", "roleName": "Farmacêutica responsável" }  (role "owner" messages and human_joined)
  "ui": { "type": "product_card", ... } }               // null when plain text; persisted in Message.uiData
```

`GET .../messages` also returns, at the top level, the conversation's pharmacy state needed to rebuild the screen after a reload: `{ "pharmacy": { "lane": "otc"|"rx"|"controlled"|"symptom"|"general"|null, "cart": CartDto, "checkoutStep": null|"contact"|"fulfillment"|"address"|"review"|"done", "orderCode": null|"PED-4821", "statusUrl": null|"…", "humanJoined": [{ memberId, name, roleName }] } }`. Cart and checkout state are persisted in `Conversation.pharmacyState` (owned by 2a).

### 8.2 `ui` payload types (2a produces, 2d renders)

All money in cents. `product.imageUrl` is the public product image URL (or `null` => placeholder icon from `placeholderIcon`).

```jsonc
{ "type": "product_card",    "product": { "id", "name", "presentation", "priceCents", "inStock": true, "maxQty": 5, "imageUrl", "placeholderIcon" }, "qty": 1 }
{ "type": "cart",            "cart": CartDto }       // CartDto = { items: [{ productId, name, qty, unitPriceCents, lineTotalCents, imageUrl }], itemCount, subtotalCents, requiresPrescription: boolean }
{ "type": "symptom_question","step": "symptom|duration|severity|for_whom|age|pregnancy|allergies|other_medicines|already_tried", "prompt": "Há quanto tempo você sente isso?", "chips": ["Hoje","1–3 dias","Mais de 3 dias"], "allowFreeText": true, "consent": ConsentCardOrNull }
{ "type": "red_flag",        "headline": "Isso pode ser urgente", "body": "Ligue 192 (SAMU) ou vá ao pronto-socorro agora.", "samuNumber": "192", "offerPharmacist": true, "handoffId": "…|null" }
{ "type": "controlled_info", "product": { "name", "presentation" }, "available": true, "priceCents": 2490, "message": "Este medicamento é controlado e não pode ser vendido online. Venha à farmácia com a receita." }
{ "type": "contact_capture", "fields": ["phone","name","email"], "recognized": null /* or { "firstName": "João", "address": MaskedAddress|null } */, "consent": ConsentCard }
{ "type": "address_capture", "saved": MaskedAddress|null, "askConfirmSaved": true, "fields": ["cep","number","complement","reference"], "numberHint": "Use só números, 12B ou \"sem número\"" }
{ "type": "fulfillment_choice", "options": [ { "value": "delivery", "label": "Entrega", "feeCents": 600, "etaLabel": "30–50 min" }, { "value": "pickup", "label": "Retirada em loja", "feeCents": 0 } ] }
{ "type": "order_review",    "items": [...], "subtotalCents", "deliveryFeeCents", "totalCents", "fulfillment": "delivery", "addressLabel": "Rua X, 120B · Água Verde", "etaLabel": "30–50 min", "paymentLabel": "Pagamento na entrega (Pix/cartão/dinheiro, conforme a farmácia)", "staleStockNotice": null /* honest message when the sheet is old */ }
{ "type": "order_confirmation", "code": "PED-4821", "status": "confirmed|pending_pharmacist", "statusUrl": "https://…/pedido/<statusToken>", "totalCents": 1490, "message": "Pedido PED-4821 recebido. …" }
{ "type": "rx_upload",       "orderRef": null, "accept": ["image/jpeg","image/png","image/webp","application/pdf"], "maxBytes": 8388608, "consent": ConsentCard }
{ "type": "human_joined",    "name": "Maria Souza", "roleName": "Farmacêutica responsável" }     // paired with kind = "human_joined" system messages
// ConsentCard = { "purpose": "pharmacy_triage" | "prescription_upload", "version": "2026-10", "text": "…pt-BR LGPD wording…", "required": true }
```

Chips ("suggestions") continue to use the existing `suggestions: string[]` field of the message result.

### 8.3 Visitor actions (structured) : `2a` implements, `2d` calls

`POST /chat/:businessId/conversations/:conversationId/pharmacy/actions` (visitor session; `RateLimitGuard`). Body `{ "type": ..., ...payload }`. Every action is also reachable through free text (chips send text); actions are the deterministic fast path (buttons, steppers, forms). Response: `{ "messages": [Message...], "pharmacy": { lane, cart, checkoutStep, orderCode, statusUrl, humanJoined } }` (the new messages already carry `ui`).

| `type` | Payload | Effect |
| --- | --- | --- |
| `cart.add` | `{ productId, qty }` | validates class gate (`otc`+confirmed, in stock, `qty <= maxQtyPerOrder`, not `pharmacistRequired`); controlled/unclassified => `controlled_info` / handoff offer, never added |
| `cart.set_qty` | `{ productId, qty }` | `0` removes |
| `cart.remove` | `{ productId }` | |
| `checkout.start` | `{}` | begins checkout (customer step) |
| `checkout.contact` | `{ phone, name?, email?, consent: true }` | recognition via `CustomerProfileService`, identifies the visitor (same as `/auth/visitor/identify`), creates `ConsentRecord` |
| `checkout.fulfillment` | `{ fulfillment: "delivery"\|"pickup" }` | pickup skips the address |
| `checkout.use_saved_address` | `{ addressId }` | |
| `checkout.address` | `SaveAddressInput` (section 9) | server-side CEP lookup, number normalization |
| `checkout.confirm` | `{}` | creates the order (`OrdersService.createFromCart`), applies auto-confirm rules, returns `order_confirmation` |
| `symptom.answer` | `{ step, value }` | advances the questionnaire; consent required before the first answer |
| `handoff.request` | `{ reason?: "symptom"\|"other" }` | "Falar com o farmacêutico" / "Avisar o farmacêutico" |

`OrdersService.createFromCart(input)` (2b exports, 2a calls): `{ businessId, leadId, conversationId, fulfillment, items:[{productId, qty}], address?: AddressFields, prescriptionIds?: string[], notes? }` => creates `Order`+`OrderItem`s (re-checking every hard rule against the DB: class, stock, qty, `pharmacistRequired`), assigns `number/code`, `statusToken`, `addressSnapshot`, `addressDiffersFromSaved`, `stockAsOfSnapshot`, attaches prescriptions, decrements nothing (stock is not reserved in v1, pharmacist confirms), applies auto-confirm, writes `OrderStatusEvent` + `BusinessAlert`s, returns the order. Pure helpers (`autoConfirmDecision`, `canEnterCart`) live in their own files and are unit tested.

### 8.4 Prescription upload (visitor) and consent text

| Method + path | Perm | Status | Request | Response |
| --- | --- | --- | --- | --- |
| `POST /chat/:businessId/conversations/:conversationId/prescriptions` | visitor (identified) | 2b (2a calls the same service) | multipart: `file` (jpeg/png/webp/pdf ≤ 8 MB, magic-byte checked), `consent: "true"`, `patientName?` | `201 { prescription: { id, code: "RX-310", status: "pending" } }`. Creates `ConsentRecord(purposes:["prescription_upload"])`, stores privately, `orderId = null` until checkout attaches it. `400 CONSENT_REQUIRED`. |
| `GET /chat/:businessId/consent-text` | public | 2a | `?purpose=pharmacy_triage\|prescription_upload` | `{ purpose, version, text }` (versioned LGPD wording; store `consentTextVersion` in `ConsentRecord`) |

### 8.5 Order status page (customer, no login)

| Method + path | Perm | Status | Response |
| --- | --- | --- | --- |
| `GET /public/orders/:statusToken` | public (rate limited; token is unguessable, 24 random bytes) | 2b | `PublicOrderDto` (poll every 20 s). `404` on unknown token. |

```jsonc
{ "code": "PED-4821", "status": "out_for_delivery", "statusLabel": "Em entrega", "fulfillment": "delivery",
  "steps": [ { "key": "received", "label": "Pedido recebido", "at": "…", "done": true },
             { "key": "confirmed", "label": "Confirmado", "at": "…", "done": true },
             { "key": "out", "label": "Saiu para entrega", "at": "…", "done": true },        // "Pronto para retirada" for pickup
             { "key": "delivered", "label": "Entregue", "at": null, "done": false } ],
  "canceled": null /* or { "reason": "Sem estoque", "at": "…" } for canceled/rejected */,
  "items": [ { "name": "Dipirona 500 mg · 10 comp.", "qty": 1, "unitPriceCents": 890 } ],
  "subtotalCents": 890, "deliveryFeeCents": 600, "totalCents": 1490, "paymentLabel": "Pagamento na entrega",
  "addressLabel": "Rua das Flores, nº •••, Água Verde",       // street number hidden even here
  "pharmacy": { "name": "Farmácia Exemplo", "phone": "+55…" /* WhatsApp routing number if any */, "logoUrl": null,
                "branding": { "primaryColor": "#0F766E", "secondaryColor": "#0B4F4A", "tertiaryColor": "#F59E0B" } },
  "updatedAt": "…" }
```

The web page itself lives in `apps/chat` at `/pedido/[token]` (2d), themed by `pharmacy.branding`.

---

## 9. Customer profile endpoints (FOUNDATION, used by the chat widget)

Prefix `/api/customers/:businessId` (the widget knows `businessId` from `GET /businesses/public/:slug`). Guard: `VisitorSessionGuard` (anonymous allowed for lookup/CEP; `me/*` need an identified visitor, else `403 VISITOR_NOT_IDENTIFIED`).

| Method + path | Rate limit | Request | Response |
| --- | --- | --- | --- |
| `POST /customers/:businessId/lookup` | IP-only (30 / 15 min) | `{ phone }` any BR format | `{ recognized: false }` or `{ recognized: true, firstName: "João", address: MaskedAddress \| null }`. Creates nothing. |
| `GET /customers/:businessId/cep/:cep` | visitor | none | `{ status: "ok", cep, street, district, city, state, provider }` or `{ status: "not_found" \| "unavailable" }`; `400 CEP_INVALID`. ViaCEP first, BrasilAPI fallback, 4 s timeout each. `street` may be empty for generic CEPs; `unavailable` => let the visitor type street/district/city/state. |
| `GET /customers/:businessId/me/address` | visitor | none | `{ default: MaskedAddress \| null }` |
| `POST /customers/:businessId/me/addresses` | visitor | `SaveAddressInput` | `{ address: MaskedAddress, isDefault, reused, differsFromSaved }` |
| `POST /auth/visitor/identify` (existing) | | `{ businessSlug, name?, phone, email? }` | `{ lead: { id }, returning: boolean, firstName: string \| null }` (`returning`/`firstName` are new, additive) |

```jsonc
// SaveAddressInput
{ "cep": "80250-000", "number": "120B" /* or "s/n", "n/a" => normalized "S/N" */, "complement": "ap 31", "reference": "portão azul",
  "street": null, "district": null, "city": null, "state": null,        // only honored when CEP provider is unavailable / CEP generic
  "replaceDefault": false }                                              // true only for the explicit "Atualizar endereço" choice
// MaskedAddress
{ "id": "…", "label": "Rua das Flores, nº •••, Água Verde", "street": "Rua das Flores", "numberMasked": "•••", "district": "Água Verde",
  "city": "Curitiba", "state": "PR", "cepMasked": "80250-•••", "isDefault": true }
```

Rules (Appendix A, implemented): phone-first recognition per business (`Lead.businessId + phoneNormalized`); the web number is **not verified**, so a known number only reveals first name + **masked** address (street number, complement and reference hidden); the saved default is **never overwritten silently**: a different address is stored as non-default history unless `replaceDefault: true` (then the old default gets `supersededAt` and stays as history; rows are never deleted); identical addresses are reused; `differsFromSaved` feeds `Order.addressDiffersFromSaved` (use `CustomerProfileService.differsFromSavedDefault` when creating the order); numbers accept `12`, `12B`, `n/a`/`s/n`/`sem número` (=> `S/N`), anything else `400 "Número inválido…"`.

---

## 10. Dashboard summary, analytics, notifications

### 10.1 Dashboard summary (`inicio`)

`GET /dashboard/summary?range=today|7d|30d` (default `7d`) — perm `inicio:view`, 2b.

```jsonc
{ "range": "7d", "generatedAt": "…", "roleFocus": "orders",            // "orders" (attendant/manager/owner) | "handoffs" (pharmacist) | "deliveries" (courier)
  "kpis": [ { "key": "orders_today", "label": "Pedidos hoje", "value": 12, "display": "12", "note": "+3 em relação a ontem" },
            { "key": "awaiting_action", "label": "Aguardando ação", "value": 3, "display": "3", "note": "1 receita para validar" },
            { "key": "open_handoffs", "label": "Atendimentos abertos", "value": 2, "display": "2", "note": "1 urgente" },
            { "key": "revenue_today", "label": "Faturamento hoje", "value": 84260, "display": "R$ 842,60", "note": "Ticket médio R$ 70,22" } ],
  "stock": { "asOf": "…", "ageHours": 5, "maxAgeHours": 24, "stale": false, "display": "Estoque atualizado há 5h" },
  "needsAction": [ { "orderId": "…", "code": "PED-4821", "customerName": "João S.", "totalCents": 1490, "kindLabel": "Entrega",
                     "statusLabel": "Novo", "badge": "blue", "reason": "new|validate_rx|stale_stock", "waitingMinutes": 2 } ],
  "handoffs": [ { "id": "…", "who": "Maria, 34", "tag": "Urgente", "badge": "red", "summary": "Dor de cabeça há 3 dias, alergia a dipirona", "createdAt": "…" } ],
  "chart": { "title": "Últimos 7 dias", "buckets": [ { "label": "Seg", "orders": 70, "revenueCents": 82000, "delivery": 50, "pickup": 20 } ] },   // today: 7 two-hour buckets "8h".."20h"; 7d: weekday labels; 30d: "S1".."S5"
  "funnel": { "conversations": 184, "carts": 61, "orders": 38, "conversionRate": 0.207 },
  "insights": [ { "id": "stock-out-top", "title": "Dipirona 500 mg sem estoque", "description": "14 clientes pediram nos últimos 7 dias e não puderam comprar.", "cta": { "label": "Abrir catálogo", "href": "/catalogo?stock=out" } } ] }
```

Which sections appear depends on permissions (a courier gets only `needsAction` of own deliveries; no revenue unless `analises:view`; handoffs only with `atendimento:view`). "Faturamento" counts `delivered` orders (not pending). Insights are computed **deterministically** from the data (top out-of-stock demand, peak hour, unclassified count, slow-to-confirm orders, stale sheet); an optional model rewrite of the wording must fall back to the deterministic text when the model is unavailable. The "Hoje" timezone is `Business.timezone`.

### 10.2 Analytics (`analises`)

`GET /analytics/pharmacy/overview?range=today|7d|30d` — `analises:view`, 2b (existing real-estate `/analytics/*` unchanged).

```jsonc
{ "range": "7d", "label": "Últimos 7 dias",
  "kpis": [ { "key": "revenue", "label": "Faturamento", "value": 702000, "display": "R$ 7.020", "note": "Pedidos concluídos" },
            { "key": "orders", "label": "Pedidos", "value": 104, "display": "104", "note": "Entrega e retirada" },
            { "key": "avg_ticket", "label": "Ticket médio", "value": 6750, "display": "R$ 67,50", "note": "Por pedido" },
            { "key": "conversion", "label": "Conversão do chat", "value": 0.198, "display": "19,8%", "note": "Conversa que virou pedido" } ],
  "chart": { "buckets": [ { "label": "Seg", "revenueCents": 82000 } ] },
  "triage": [ { "key": "orders", "label": "Viraram pedido", "count": 38, "percent": 21 }, { "key": "handoff", "label": "Encaminhadas ao farmacêutico", "count": 27, "percent": 15 },
              { "key": "controlled", "label": "Controlado: só informação", "count": 9, "percent": 5 }, { "key": "red_flag", "label": "Sinal de alerta (urgente)", "count": 2, "percent": 1 },
              { "key": "general", "label": "Dúvidas gerais", "count": 108, "percent": 59 } ],
  "topProducts": [ { "productId": "…", "name": "Dipirona 500 mg", "units": 64, "revenueCents": 56960 } ],
  "unmetDemand": [ { "productId": "…", "name": "Dipirona 500 mg", "requests": 14 } ] }
```

Chat events (2a emits through `AnalyticsService.recordEvent`, 2b aggregates; properties carry ids and enums only, **no text**): `pharmacy_product_requested {productId, inStock}`, `pharmacy_cart_created {itemCount}`, `pharmacy_order_created {orderId, fulfillment, totalCents, autoConfirmed, hasPrescription}`, `pharmacy_handoff_created {handoffId, reason, urgent}`, `pharmacy_red_flag {}`, `pharmacy_controlled_inquiry {productId}`, `pharmacy_symptom_started {}`, `pharmacy_checkout_abandoned {step}`. Unmet demand = `pharmacy_product_requested` with `inStock=false` (or class-blocked) grouped by product.

### 10.3 Notifications (non-disableable)

There is **no setting to turn them off** (UI shows the static banner "Notificações de pedidos estão sempre ativas."). Channels in v1: (1) `BusinessAlert` rows (existing `GET /alerts`, `POST /alerts/:id/dismiss`, banner in the dashboard), (2) email (existing `sendEmail`, stub-logging without `RESEND_API_KEY`) to the business email and to every active member whose permissions include the relevant section, (3) the sidebar badge counts below. Staff web-push is NOT in v1 (gap documented).

| Event | Alert `type` (severity) | Who gets email |
| --- | --- | --- |
| new order | `pharmacy_new_order` (info) | members with `pedidos:view` |
| order waiting > `orderReminderMinutes` | `pharmacy_order_waiting` (warning), repeated every interval until acted on (worker job) | same |
| new handoff (urgent flagged) | `pharmacy_new_handoff` (`critical` when urgent, else warning) | members with `atendimento:view` |
| prescription uploaded | `pharmacy_rx_uploaded` (info) | members with `receitas:view` |
| stock sheet older than `stockMaxAgeHours` | `pharmacy_stale_sheet` (warning), once per sheet | `importar:edit` |

`GET /notifications/summary` — any member, 2b; counts filtered by the member's permissions (missing => omitted):

```json
{ "orders": { "new": 3, "waitingOverMinutes": 1 }, "handoffs": { "open": 2, "urgent": 1 }, "prescriptions": { "pending": 1 }, "sheet": { "stale": false, "ageHours": 5 } }
```

Sidebar badges: Pedidos = `orders.new` + `prescriptions.pending`, Atendimento farmacêutico = `handoffs.open`. Poll every 20 s.

---

## 11. Worker jobs (2b)

| Job (queue) | Trigger | Action |
| --- | --- | --- |
| `catalog-import:map` | upload | parse first sheet, detect header, ONE model call with ≈20 sample rows (heuristic fallback if the model fails), store `mapping`/`previewRows`/`dryRun` |
| `catalog-import:apply` | big files only | apply deterministically in batches |
| `pharmacy:order-reminders` | every minute | create/refresh `pharmacy_order_waiting` alerts + emails |
| `pharmacy:stale-sheet` | hourly | stale-sheet alert |
| `pharmacy:retention-purge` | daily | delete prescription files past `retentionDeleteAt` (set `fileDeletedAt`), null out expired `PharmacistHandoff.brief` (set `{}` and `retentionDeleteAt` honored), log counts only |

---

## 12. Test expectations (so the pieces fit)

- 2a: harness scenarios of HANDOFF 5.8 with a stubbed model, including "pharmacist brief never present in any `Message.content`", "customer messages contain no product name or dose in lane E", "returning customer sees masked address".
- 2b: unit tests for the order state machine (every allowed and forbidden transition), permission matrix on the new routes (each route denies a role lacking the section and CRF), import mapping fallback without a model, retention purge, `canEnterCart`/`autoConfirmDecision`, proposals confirm, team rules via the services.
- Keep `cd apps/api && node --import tsx --test test/*.test.ts` green (178 at the end of wave 1).

---

## 13. Addendum from wave 2a (chat engine): what was actually built

Read together with section 8. Deviations are small and additive.

- **Text turns** (`POST .../messages`, `.../messages/stream` `done` event) for a pharmacy return `{ message, messages, suggestions, pharmacy, escalated: false }`. `message` is the first assistant message of the turn; `messages` is the whole list (usually 1; out-of-stock-with-equivalents sends a text message followed by one `product_card` message per equivalent). **2d must render `messages` when present.** General questions that go to the model return the usual `{ message, suggestions }` (no `pharmacy` key; `GET .../messages` always has it).
- **Extra visitor actions** (same endpoint as 8.3): `cart.view {}`, `cart.clear {}`, `rx.check {}` (call it right after a prescription upload so the engine moves the pending prescription line into the cart immediately; without it the next visitor turn does the same). `handoff.request {reason: "other"}` creates a handoff straight away; `"symptom"` (default) starts the questionnaire.
- **ConsentCard purposes**: besides `pharmacy_triage` and `prescription_upload` the checkout customer step uses `order_contact` (card inside `contact_capture`). `GET /chat/:businessId/consent-text?purpose=` accepts the three.
- **Prescription uploads are detected by DB state**: a `PrescriptionUpload` with `conversationId = <this conversation>`, `orderId = null`, `status != rejected` counts as attached. 2b's upload endpoint MUST set `conversationId`. At order creation the engine passes those ids to `createFromCart(prescriptionIds)`.
- **Handoff brief keys** (all in `PharmacistHandoff.brief`, never in a message): symptom handoffs as in 7.3 plus `suggestionNote`, `customerText` (red flag only) and `followUps: string[]` (extra symptom messages sent after the handoff). Controlled / pharmacist-required: `{ medication, availability, priceInformedCents, onlineSaleAllowed: false, customerRequest, conversationLink }`. Out of stock: `{ requestedProduct, medication, stock, availability, equivalents: [{productId, name, stockQty?, priceCents?}], customerRequest, conversationLink }`. `other`: `{ customerRequest, conversationLink }`. Reasons used: `symptom` (questionnaire, red flag), `controlled` (controlled product only), `out_of_stock` (also the equivalent-swap confirmation created together with the order), `other` (unclassified/pharmacist-required products, "só chamar o farmacêutico"). `rx` is not created by the chat (the prescription is an upload on the order).
- **Order creation** uses `PHARMACY_ORDERS_PORT` (chat/pharmacy/types.ts). The default implementation is Prisma-direct inside chat/. Extra input fields beyond API.md 8.3: `items[].viaEquivalentOf`, `requirePharmacist`, `addressDiffersFromSaved`; extra output: `staleSheet`, `pendingReasons`. 2b's `OrdersService.createFromCart` can be bound to the same token (set `handlesNotifications = true` on it if it writes its own alerts).
- **Human join**: `ChatHumanService.recordHumanReply({ businessId, conversationId, author: { memberId, name, roleName }, text })` (exported by `ChatModule`).

---

## 14. Addendum from wave 2b (domain REST + worker): deviations and additions

Everything in sections 3 to 10 is implemented. Differences from the text above (all small, additive unless stated):

- **Catalog import**: `.xls` (old Excel) is **not supported**: `POST /catalog-imports` answers `400 UNSUPPORTED_FORMAT` with the hint to save as `.xlsx`/`.csv` (SheetJS, the only xls reader, has open CVEs; `exceljs` reads xlsx). Other upload errors: `FILE_REQUIRED`, `FILE_TOO_LARGE`, `CORRUPT_FILE`. `POST /catalog-imports/:id/mapping` answers **200** (not 201) and `409 MAPPING_INCOMPLETE` when `name`/`price` are not mapped (also re-checked at apply). Extra fields: `mapping.columns[].index`, `dryRun.rejected` (rows with a name but no usable price), `stats` is `null` until `status = "applied"`. `previewRows` keys follow the sheet's column order. Duplicates inside one file: first row wins (later ones count as `skipped`, stock is never summed). Products absent from a new sheet are left untouched. A controlled substance of the bundled reference list is always proposed `controlled`, even if the sheet says "Venda livre" (documented safety override of the "explicit column first" order). Class proposals by the model (last resort) happen at **apply** time (capped at 200 products), so `dryRun.classSummary` may classify slightly fewer products than the final result.
- **Jobs without a worker**: if nobody starts a queued `catalog-import` job within `CATALOG_IMPORT_FALLBACK_SECONDS` (default 8; `0` disables) the API runs it inline when the import is polled, so imports never hang in dev.
- **Queue names** have no colon (BullMQ forbids it): `catalog-import` (jobs `map`, `apply`), `pharmacy-order-reminders` (every minute), `pharmacy-stale-sheet` (hourly), `pharmacy-retention-purge` (daily 03:30). They call `POST /internal/businesses/:businessId/catalog-imports/:id/(map|apply)` and `POST /internal/pharmacy/(order-reminders|stale-sheet|retention-purge)` (header `x-internal-token`).
- **Products**: `PATCH` also accepts `active`; `GET /products/:id` returns `equivalents`; `POST /products/:id/class` sets `classProposed` to the chosen class (`classProposedBy: "manual"`) so a pharmacist decision never shows as "needs review". Group confirm (`/catalog/class-review/groups/:key/confirm`) only touches products **not yet confirmed**.
- **Orders**: `actionLabels` has `confirm`, `out`, `done`, `cancel` (not just `out`). Courier role: may only `out` and `done` on orders assigned to them (`403 OWN_DELIVERIES_ONLY` for someone else's order, `403 PERMISSION_DENIED` for other actions; a courier asking `GET /orders/:id` for another courier's order gets `404`). `rejectForPrescription` (prescription reject) cascades only when the order is still `pending_pharmacist`.
- **`OrdersService.createFromCart`** (exported by `OrdersModule`, `handlesNotifications = true`) is a drop-in for the chat engine's `PHARMACY_ORDERS_PORT`: input adds `items[].viaEquivalentOf`, `requirePharmacist`, `requireReasons`, `addressDiffersFromSaved`; output adds `staleSheet`, `pendingReasons`, `statusUrl`. Auto-confirm freshness uses the **oldest `stockAsOf` among the order's products** (a manual stock edit refreshes only that row). `PharmacyNotificationsService` (global module) also implements the engine's `PharmacyNotifierPort.notify`.
- **Prescription upload** is `PrescriptionsService.upload` behind `POST /chat/:businessId/conversations/:conversationId/prescriptions`; it stores `conversationId`, `leadId`, `orderId = null`, `status = pending`. Needs an identified visitor (`403 VISITOR_NOT_IDENTIFIED`), `consent` of `"true"`, magic-byte check (the client MIME is ignored). Rejecting a prescription also posts a `system` message in the customer's conversation with the pharmacist's reason.
- **Handoff reply** goes through `ChatHumanService.recordHumanReply` (banner + author-stamped message). Visitor push is sent only when the visitor is not live and its body is generic ("O farmacêutico respondeu ao seu atendimento."). "answered -> open when the customer writes again" is applied lazily on every handoff read.
- **Branding**: logo upload is stored under `branding/<businessId>/logo.<ext>` and served by `GET /public/businesses/:businessId/logo`; `branding.update` is now logged for PUT/PATCH/logo. `billing.change` is logged on checkout / portal.
- **Dashboard summary**: for a courier role only `kpis[my_deliveries]` and `needsAction` (own active deliveries) are returned; `chart`/`funnel` are `null` without the permission; chart buckets omit `revenueCents` without `analises:view`. `insights` are deterministic only (no model rewrite was built).
- **Notifications**: `BusinessAlert` rows are created per event (no per-type de-duplication, so an urgent `critical` handoff alert is never hidden by an older `warning`); an order-waiting alert is refreshed per order every `orderReminderMinutes`; any new order / handoff / prescription also e-mails the business address and every active member who can see the section (logs the mail without `RESEND_API_KEY`). `GET /notifications/summary` returns `{}` for non-pharmacy businesses.
- **Team**: `POST /team/members/:id/resend-invite` also returns `inviteUrl` in dev. Disabling yourself answers `LAST_OWNER` when you are the last owner, else `400 CANNOT_DISABLE_SELF`. Role names are unique per business (`400 ROLE_NAME_IN_USE`). `/team/roles/permission-sections` returns the pharmacy rows in prototype order.
- **Customers**: `GET /customers` lists the business's leads (`total` counts the filter); `addressLabel` is always the masked default address.
