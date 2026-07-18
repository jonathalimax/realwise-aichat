# Billing

Status: IMPLEMENTED_NOT_VERIFIED

Billing now has persisted `plans`, `subscriptions` and `usage_events` tables. The demo seed creates a `pilot` plan and active tenant subscription. `/api/billing/entitlements` is tenant-guarded and returns DB-backed limits/usage when configured. The worker writes idempotent `MESSAGE_PROCESSED` usage events for processed messages. Stripe activation remains `IMPLEMENTED_NOT_VERIFIED` until real credentials and webhook evidence exist.

Next: Stripe Checkout, Customer Portal, webhooks and reconciliation.
