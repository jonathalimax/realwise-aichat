# Realwise AI Chat — Master Plan

**Status:** implementation specification  
**Owner:** Realwise  
**Last consolidated:** 2026-07-17

## Mission

Build a secure commercial SaaS that lets small businesses connect WhatsApp, Instagram, and Facebook Messenger, train an AI assistant with approved business knowledge, capture leads and appointment requests, and transfer conversations to humans through a shared inbox.

Customers must not manually copy access tokens, webhook URLs, WABA IDs, phone-number IDs, Page tokens, or application secrets.

## Product principles

1. Humans always retain control.
2. Prices, schedules, policies, eligibility, and availability must be grounded.
3. Unrelated tenants never share records, vectors, inbox accounts, billing data, prompts, or logs.
4. Realwise owns Meta onboarding, credentials, webhooks, AI, knowledge, billing, and analytics.
5. Chatwoot is the replaceable human-inbox layer.
6. Mocked integrations are never described as production verified.
7. Self-host open-source infrastructure where operationally sensible.
8. Billing, support, security, accessibility, backups, legal drafts, and operations are part of the product.

## MVP scope

- Invite-only account and tenant creation
- Email verification, password reset, sessions, optional TOTP, mandatory admin MFA
- One Chatwoot account per tenant
- WhatsApp Cloud API onboarding and eligible Coexistence
- Instagram professional-account messaging
- Facebook Page Messenger
- AI replies grounded in tenant knowledge
- Manual FAQ, text, structured data, PDF, and safe website import
- Lead capture and trial appointment requests
- Human handoff and AI pause/resume
- Stripe Checkout, Customer Portal, subscriptions, trials, entitlements, and dunning
- Product and business analytics
- Support console and sanitized diagnostics
- Coolify, backups, restore, CI, security, accessibility, and load gates

## Deferred

- Public comments and comment-to-DM
- Broadcast marketing
- Full CRM
- Voice calls
- Chatwoot fork
- Stripe Connect
- Customer-authored arbitrary workflows
- Automatic booking confirmation without authoritative availability
- Local LLM on the initial small VPS

## Architecture

```text
WhatsApp Cloud API ─────┐
Instagram Messaging ────┼─> Realwise Meta Gateway
Facebook Messenger ─────┘          │
                                    ├─> Messaging Core
                                    ├─> AI + Knowledge + Tools
                                    ├─> Leads + Appointments
                                    ├─> Stripe + Entitlements
                                    ├─> Analytics + Support
                                    └─> Chatwoot API Inbox
                                                │
                                          Human agents
```

## Monorepo

```text
apps/
  web/
  api/
  worker/
  mock-meta/
packages/
  auth/
  billing/
  chatwoot/
  config/
  contracts/
  database/
  encryption/
  integrations/
  knowledge/
  meta/
  observability/
  testing/
  ui/
infrastructure/
  coolify/
  docker/
  backups/
  scripts/
docs/
.openharness/
.github/workflows/
```

Use TypeScript, pnpm workspaces, Turborepo, Next.js App Router, NestJS, PostgreSQL, pgvector, Redis, BullMQ, Drizzle, Zod, Playwright, and a deterministic fake AI provider for tests.

## Implementation order

1. Research official provider requirements and pin versions.
2. Establish repository, CI, config validation, and local Docker.
3. Implement tenancy, auth, encryption, audit, and database.
4. Deploy and provision Chatwoot locally.
5. Implement normalized messaging and mock providers.
6. Implement WhatsApp, Instagram, and Facebook adapters.
7. Implement AI, knowledge, tools, and handoff.
8. Implement customer dashboard and public site.
9. Implement Stripe and entitlements.
10. Implement analytics, notifications, support, export, and deletion.
11. Complete security, accessibility, load, AI-evaluation, and restore tests.
12. Prepare Coolify and external activation runbooks.
13. Run a pilot before controlled self-service.

## Truthful release states

```text
PLANNED
IMPLEMENTED_NOT_VERIFIED
MOCK_VERIFIED
SANDBOX_VERIFIED
READY_FOR_EXTERNAL_ACTIVATION
PRODUCTION_VERIFIED
```

Nothing becomes `PRODUCTION_VERIFIED` without real provider evidence.
