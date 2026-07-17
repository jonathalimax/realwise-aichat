# Definition of Done

## Repository
Build, lint, typecheck, migrations, docs, no secrets, and coherent PR.

## Security
Authorization and cross-tenant tests, encryption, OAuth state, signatures, SSRF, sensitive-log detection, admin MFA, step-up, and no unresolved critical/high findings.

## Messaging
Mock WhatsApp/Instagram/Facebook end to end, duplicates/order/loops safe, human pauses AI, Chatwoot provisioning/repair, and delivery stored.

## AI
Structured validation, tenant-only retrieval, hallucination tests, human-request handoff, prompt-injection tests, tool allowlist, evaluation report, and source evidence.

## Billing
Stripe test Checkout and Portal, signature verification, idempotency, entitlements, trial, failure/recovery, cancellation, reconciliation, and no card handling.

## UX
Onboarding, channels, knowledge, playground, leads, appointments, team, billing, support, responsive states, accessibility, and reviewed screenshots.

## Operations
Healthy Compose, production image build, valid Coolify configuration, health, rotation, metrics, backup, restore, runbooks, rollback, and incidents.

## External truth

Real Meta is done only with real credentials, permissions, assets, and message evidence. Stripe live mode is done only after a real controlled payment and reconciliation.

Without external activation, report:

```text
APPLICATION IMPLEMENTED
LOCAL AND MOCKED FLOWS VERIFIED
STRIPE TEST MODE VERIFIED
READY FOR META AND PRODUCTION ACTIVATION
```
