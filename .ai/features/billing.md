# Billing

Status: IMPLEMENTED_NOT_VERIFIED

Billing now has persisted `plans`, `subscriptions` and `usage_events` tables. The demo seed creates a `pilot` plan and active tenant subscription. `/api/billing/entitlements` is tenant-guarded and returns DB-backed limits/usage when configured. The worker writes idempotent `MESSAGE_PROCESSED` usage events for processed messages. Stripe activation remains `IMPLEMENTED_NOT_VERIFIED` until real credentials and webhook evidence exist.

Implemented mock activation seam:

- `billing_sessions` records checkout/portal sessions.
- `POST /api/billing/checkout-session` creates a mock checkout session.
- `POST /api/billing/portal-session` creates a mock customer portal session.
- API smoke verifies both endpoints.

Next: replace mock session creation with Stripe Checkout/Customer Portal, then add Stripe webhooks and reconciliation.
