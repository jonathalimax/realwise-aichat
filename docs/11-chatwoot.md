# Chatwoot Integration

Chatwoot Community Edition is the human inbox, not the Realwise control plane.

## Responsibilities

Chatwoot:
- conversation interface;
- agents and teams;
- assignment;
- labels;
- internal notes;
- statuses;
- attachments.

Realwise:
- onboarding;
- Meta credentials and webhooks;
- AI and knowledge;
- billing and usage;
- business tools;
- integrations and analytics.

## Isolation

Create one Chatwoot account per Realwise tenant and one API inbox per connected channel. Never combine unrelated tenants in one account.

## Provisioning

1. Create account through Platform API.
2. Create or link owner user.
3. Assign role.
4. Register webhook.
5. Store object IDs.
6. Create inboxes after channel connection.

Provisioning is idempotent, auditable, and repairable.

## Inbound

```text
Meta event
→ Realwise verify/normalize
→ resolve tenant/contact/conversation
→ create/update Chatwoot contact
→ create conversation and incoming message
→ run AI if allowed
```

## Outbound

```text
Chatwoot outgoing message
→ Realwise webhook verification
→ resolve connection and origin
→ send through Meta
→ store external ID
→ process delivery status
```

## Loop prevention

Use origin, provider message ID, Chatwoot message ID, delivery ID, idempotency key, message state, and unique constraints.

Origins:

```text
META_CUSTOMER
META_WHATSAPP_APP_HUMAN
CHATWOOT_HUMAN
REALWISE_AI
REALWISE_SYSTEM
```

## Commands

```text
pnpm chatwoot:provision-tenant --tenant=<id>
pnpm chatwoot:repair-tenant --tenant=<id>
pnpm chatwoot:audit
```

Back up Chatwoot database and attachments and monitor web, worker, Redis, PostgreSQL, jobs, and upgrades.
