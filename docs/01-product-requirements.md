# Product Requirements

## Goals

- Secure multi-tenant SaaS.
- Official WhatsApp, Instagram, and Facebook Messenger integrations.
- Tenant-grounded AI.
- Chatwoot Community Edition for humans.
- Stripe subscriptions.
- Coolify deployment.
- Pilot readiness for Brazilian academies.

## Personas

- Business owner
- Tenant administrator
- Attendant
- Billing administrator
- Platform support
- Platform administrator
- Platform owner

## Functional requirements

### Tenant lifecycle
Create tenant, invite members, assign roles, configure business, export data, suspend, and schedule deletion.

### Channel onboarding
Start provider login inside Realwise, validate state, discover authorized assets, encrypt credentials, subscribe webhooks, create Chatwoot API inbox, test connection, show diagnostics, reconnect, and disconnect.

### Messaging
Normalize events, upsert contact/conversation, mirror inbound messages to Chatwoot, evaluate AI state, send AI or human replies, track delivery, prevent duplicates and loops, and process attachments safely.

### AI
Use structured decisions, retrieve tenant-only knowledge, call allowlisted tools, ask focused questions, hand off on low confidence or human request, respect business hours and human-active state, and record sources.

### Knowledge
Support structured business information, FAQ, text, PDF, and safe website import. Version sources and delete derived chunks.

### Leads and appointments
Capture contact, service, age, preferred time, and notes. Create requests, not false confirmations. Notify the business through controlled integrations.

### Billing
Support trial, Checkout, subscription lifecycle, entitlements, usage, dunning, Customer Portal, plan changes, and reconciliation.

### Support
Provide sanitized diagnostics, safe retries, Stripe and Chatwoot reconciliation, time-limited exceptional access, and audit events.

## Non-functional requirements

- tenant isolation;
- OWASP ASVS Level 2 target;
- WCAG 2.2 AA target;
- idempotent webhooks;
- structured low-volume logs;
- backups and restore tests;
- bounded pagination;
- graceful provider degradation;
- responsive UI;
- truthful release status.

## MVP acceptance

- Complete academy onboarding.
- Mock all three channels end to end.
- Activate real test-mode channels when credentials exist.
- Ground schedule and price answers.
- Stop prompt injection from changing tool permissions.
- Pause AI on human reply.
- Enforce Stripe test entitlements.
- Reject duplicate events safely.
- Prove Tenant A cannot access Tenant B across APIs, vectors, Chatwoot links, exports, billing, and analytics.
