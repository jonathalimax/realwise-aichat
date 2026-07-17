# Project Context

## Product

Realwise AI Chat is a multi-tenant SaaS that connects WhatsApp Business, Instagram Direct Messages, and Facebook Messenger to a tenant-grounded AI assistant and a shared human inbox.

## Primary users

- **Business owners:** configure channels, knowledge, billing and operating rules.
- **Tenant admins:** manage team, assistant, diagnostics and data.
- **Attendants:** handle conversations after handoff or AI pause.
- **Billing admins:** manage plan, usage and invoices.
- **Platform support/admins:** diagnose integrations with sanitized access and audit logs.

## Repository model

This is a pnpm workspace monorepo.

| Path | Purpose |
|---|---|
| `apps/web/` | Customer dashboard and public/customer UI with Next.js App Router |
| `apps/api/` | NestJS REST API for auth, tenants, onboarding, webhooks, knowledge, assistant, billing and health |
| `apps/worker/` | BullMQ workers for provider events, AI, imports, billing reconciliation and diagnostics |
| `apps/mock-meta/` | Deterministic mock Meta provider for OAuth and webhook scenarios |
| `packages/*` | Shared contracts, config, database, encryption, integrations, knowledge, UI and testing |
| `infrastructure/` | Docker, Coolify, backups and support scripts |

## Source of truth

- `.ai/` is the agent-facing implementation source.
- `MASTER_PLAN.md` and `docs/` are product/architecture specifications.
- `README.md` is human onboarding.
