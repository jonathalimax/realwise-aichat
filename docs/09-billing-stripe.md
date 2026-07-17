# Stripe Billing

## Principles

- Stripe-hosted Checkout creates subscriptions.
- Customer Portal handles payment methods, invoices, plan changes, and cancellation.
- One Stripe Customer per tenant.
- Verified webhooks update local billing state.
- Local entitlements control access.
- A browser success redirect never proves payment.
- Realwise never handles card numbers.
- Stripe Connect is out of scope.

## Plans

```text
TRIAL
STARTER
BUSINESS
PRO
CUSTOM
PAST_DUE
SUSPENDED
CANCELED
```

Commercial prices and Stripe Price IDs are configuration, not authorization constants.

## Entitlements

```typescript
type PlanEntitlements = {
  maximumChannels: number;
  maximumUsers: number;
  maximumLocations: number;
  maximumKnowledgeSources: number;
  maximumMonthlyAIResolvedConversations: number;
  maximumMonthlyMessages: number;
  retentionDays: number;
  websiteImportsEnabled: boolean;
  pdfImportsEnabled: boolean;
  n8nIntegrationsEnabled: boolean;
  analyticsEnabled: boolean;
  prioritySupportEnabled: boolean;
};
```

## Endpoints

```text
POST /api/billing/checkout
POST /api/billing/portal
POST /api/webhooks/stripe
GET  /api/billing/summary
GET  /api/billing/invoices
```

Checkout accepts a server-known plan and interval, never a raw client amount.

## Webhooks

Preserve raw body, verify signature, persist event ID, acknowledge quickly, process asynchronously, and make all handlers idempotent. Pin a Stripe API version and verify current event names during implementation.

Cover Checkout completion, subscription create/update/delete, invoice paid/failure/action required, and refunds.

## Access policy

- trialing/active: grant plan access;
- past_due: warning and grace;
- unpaid: disable outbound AI, preserve data and human inbox;
- paused: disable paid capabilities;
- cancel at period end: retain access until effective end;
- platform suspension: overrides provider state.

## Reconciliation

Detect missing/duplicate customers, missed events, price mismatch, and local/provider status divergence. Do not apply ambiguous destructive corrections automatically.

## Usage and limits

Meter channels, users, messages, AI attempts, AI-resolved conversations, knowledge, and provider-cost estimates. Warn at 70%, 85%, and 100%. At hard AI limit, retain inbound messages and allow human handling.

## Tests

Test-mode Checkout, Customer Portal, valid/invalid signature, duplicate/out-of-order events, activation, failure/recovery, cancellation, upgrade/downgrade, reconciliation, tenant isolation, and rejection of raw amounts.
