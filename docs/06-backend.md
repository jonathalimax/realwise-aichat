# Backend Architecture

## Applications

### API
NestJS REST API for auth, tenants, onboarding, webhooks, knowledge, assistant, billing, support, admin, OpenAPI, and health.

### Worker
BullMQ workers for provider events, delivery, AI, imports, embeddings, Stripe reconciliation, retention, exports, emails, and diagnostics.

### Mock Meta
Deterministic OAuth, webhook, token, failure, duplicate, ordering, and rate-limit simulation.

## Modules

```text
Auth Tenancy Users Audit Encryption Channels Meta Messaging Chatwoot
AI Knowledge Tools Leads Appointments Billing Usage Analytics
Notifications Support Jobs Health
```

## Request lifecycle

Correlation ID → session → tenant → authorization → validation → application service → transaction → durable job/event → safe response → audit if required.

## External calls

Use timeout, bounded retries, idempotency, circuit breaker, safe errors, correlation IDs, metrics, and rate-limit awareness. Retries cannot duplicate messages, subscriptions, refunds, accounts, or inboxes.

## Health

```text
/api/health/live
/api/health/ready
/api/health/dependencies
```

Liveness is minimal. Readiness checks critical local dependencies. Detailed dependency health is authorized.

## Logging

Log IDs, event type, state, duration, and safe error code. Exclude full messages, documents, tokens, authorization codes, passwords, MFA secrets, and payment method data.
