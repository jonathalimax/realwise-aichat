# Pharmacy dashboard (wave 2c): report

Scope: `apps/dashboard/**` only. Coded against `API.md`; checked with `npx tsc --noEmit` and `next build` (both green) and clicked through against a throwaway mock of the contract (not committed). Not yet exercised against the real API with seeded data (wave 3).

## URLs (basePath unchanged: `/imobiliaria/app`)

`/inicio`, `/pedidos` (`?tab=receitas`, `?open=<orderId>`, `?rx=<id>`), `/atendimento` (`?open=`), `/catalogo` (`?stock=out`, `?class=`, `?open=`), `/catalogo/classes`, `/catalogo/importar`, `/clientes`, `/conversas` (`?open=`), `/analises`, `/farmacia` (`?tab=identidade|entrega|retirada|limites|estoque|horarios|aparencia`), `/equipe` (`?tab=funcoes|registro`), `/equipe/funcoes/nova` (`?from=<roleId>` duplicates) and `/equipe/funcoes/<id>`, `/plano`, `/assistente`, `/login`, `/convite/<token>`, `/redefinir-senha?token=`, `/sem-acesso`. `/` redirects pharmacy members to their first allowed section. Real-estate routes are untouched (`/`, `/leads`, `/inbox`, ...).

`basePath` can now be overridden at build time with `NEXT_PUBLIC_BASE_PATH` (default `/imobiliaria/app`, so nothing changes). The API still builds invite/reset links with `/imobiliaria/app`, so a different prefix also needs `email-links.ts` updated.

## Done

- **Shell**: `components/AppShell.tsx` + `components/shell/*` (Sidebar, NoAccess, AlertsStrip, BrandingApplier). `lib/session.tsx` loads `GET /auth/me` + legacy `GET /businesses/me`, polls `GET /notifications/summary` every 20 s (badges: Pedidos = new + pending Rx, Atendimento = open handoffs). Sidebar is niche-aware (`lib/nav.ts`) and permission-aware (only sections with level >= view; "Assistente" needs `farmacia:edit`). Routes without access render "Sem acesso" in place (`requirementFor`), 403 on any page load renders the same. Real estate keeps its own item set (now filtered by permissions, plus "Equipe e acessos").
- **Branding**: `BrandingApplier` writes `--brand-primary/secondary/tertiary/soft` and re-points the legacy tokens (`--accent`, `--secondary`, `--tertiary`, ...) for pharmacy or any business with custom colours; `<html data-ui="shadcn">` switches the neutral zinc palette (opt-in, real-estate keeps its look). Tailwind has `bg-brand`, `text-brand-2`, `bg-brand-soft`.
- **UI primitives restyled** (shadcn look, same exports): button, card (single 20px gutter, header/content align), table (`bare` inside cards; first/last cell padding = card padding), badge (tone variants `green/amber/gray/red/blue/soft/outline`), segmented + new `Tabs`, input/textarea, label, checkbox, sheet (+title/description) and new `side-panel`, dialog, alert, switch, select, progress, avatar, skeleton, KPI card. Shared kit in `components/page-kit.tsx` (PageHeader, LoadState with loading/error/403, EmptyState, ErrorState, Field, SectionCard...).
- **Login**: tab "E-mail e senha" (member login, ambiguity picker, forgot password inline) next to the untouched phone/Firebase owner flow (default tab is e-mail when Firebase is not configured). **Accept invite** (themed with the business colours, CRF when the role needs it, LGPD checkbox), **reset password**, **Sem acesso**.
- **Início**: greeting, range tabs, stale/absent sheet alert, KPIs, needs-action table, open handoffs, orders chart (delivery/pickup stacks), funnel, insights, role focus ordering.
- **Pedidos**: status tabs with counts, type filter, search, load more, 20 s refresh; detail sheet with server-driven actions (`allowedActions`/`actionLabels`), cancel dialog with reason (+ note for "other"), courier assignment, timeline, stale/Rx/address-differs warnings; Receitas tab with protected-file viewer (blob via cookie, PDF or image, no public URL), approve/reject (CRF only) with reason.
- **Atendimento farmacêutico**: inbox, brief rows, pharmacist-only suggestion, reply (as name + role), close, read-only for members without CRF.
- **Catálogo**: filters with counts, search, thumbnails (real image via public image route or tinted placeholder icon by type), product sheet (edit, image upload/remove, class change for pharmacists, pharmacist-required switch, equivalents), links to Revisar classes and Importar. **Revisar classes** (progress, groups, confirm all, per-product confirm, manual class for "Incertos"). **Importar planilha** stepper (upload -> mapping with confidence and model-fallback notice -> classes -> confirm with `stockAsOf` + checkbox -> done) plus history.
- **Clientes** (+ sheet with masked addresses, consent, recent orders), **Conversas** (read-only mirror on the existing inbox read routes: human-joined banner, "Alex · IA" label, author name and role), **Análises**.
- **Farmácia** settings: Identidade (owner-only edit), Entrega (+ pagamento), Retirada (+ política de troca), Limites, Estoque, Horários, Aparência (3 colour pickers + hex, logo upload, reset, live chat preview, chat shortcuts); proposals from the interview marked "confirmar" with confirm/dismiss; always-on notifications banner.
- **Equipe e acessos** (generic, reusable by real estate): members (change role/CRF, disable/enable, resend/cancel invite, owner protection, "(você)"), invite dialog (dev `inviteUrl` copy), roles list (duplicate, delete), role editor permission grid (none/view/edit, CRF lock, read-only rows, notes from the API, fallback to `@realwise/shared` when the route is missing), access log (owner/manager only, filters, load more).
- **Plano e cobrança** (`/plano`, and `/billing` which is the Stripe return URL): shared `BillingView` (current plan, month usage from the subscription, plans, portal).
- **Assistente**: existing `InterviewChat` with `assistantName="Alex"` plus a banner pointing to the pending proposals in Farmácia.

## Partial / not done

- Plano: no invoices table and no usage beyond conversations (no API route); invoices live in the Stripe portal.
- Farmácia: "produtos que sempre exigem farmacêutico" is set per product in Catálogo (no list/matching UI for `pharmacistRequiredProductNames`); Retirada has no "aviso ao cliente" (no such field in the settings DTO).
- Conversas filters are "Todas / Atendimentos" (no "Pedidos" filter or order/handoff tag: the inbox list carries neither). Messages with `ui` payloads (cards) render as plain text.
- Dark mode is not styled for the new palette. No "Pedir acesso ao proprietário" action (no endpoint).
- `tsconfig.tsbuildinfo` (tracked) changes whenever `tsc` runs; revert it before committing if unwanted.

## API routes consumed (all coded to `API.md`; none hard-coded)

Everything in API.md sections 3 to 10 used by the screens above: auth (`/auth/me`, `/auth/member/login|forgot-password|reset-password`), `/notifications/summary`, `/alerts`, `/dashboard/summary`, `/analytics/pharmacy/overview`, `/orders*`, `/prescriptions*`, `/handoffs*`, `/products*`, `/catalog/class-review*`, `/catalog-imports*`, `/customers*`, `/pharmacy/settings*`, `/businesses/me/branding*`, `/team/*`, plus existing `/inbox/conversations*`, `/billing/*`, `/businesses/me`, `/onboarding/interview`. When this was written the controllers for these existed in `apps/api/src/modules` (2b) but had not been run against the dashboard. Where a route is missing (404 "Cannot GET ...") the page shows "Esta área ainda não está disponível"; `/notifications/summary` and `/alerts` fail silently (no badges/strip). `POST /businesses/me/branding/logo`, `GET /team/roles/permission-sections` and the forgot/reset password routes are the ones most likely to be late: the grid falls back to `@realwise/shared`, logo upload shows the API error.

## Files

`apps/dashboard/src/{app/{inicio,pedidos,atendimento,catalogo,clientes,conversas,analises,farmacia,equipe,plano,assistente,convite,redefinir-senha,sem-acesso},components/{shell,pharmacy,team,ui,page-kit.tsx,page-notifications.tsx,BillingView.tsx,AppShell.tsx},lib/{pharmacy-api,session,nav,labels,format,color,use-load,use-debounced}}`, `globals.css`, `tailwind.config.ts`, `next.config.mjs`.
