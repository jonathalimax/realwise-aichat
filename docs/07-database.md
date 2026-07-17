# Database Design

Use separate Realwise and Chatwoot databases/users even if one PostgreSQL server is shared. Enable pgvector in Realwise.

## Entity groups

Identity: users, sessions, verification/reset tokens, MFA, tenants, memberships, invitations.

Chatwoot: installation, account links, user links, inbox links.

Channels: connections, encrypted credentials, attempts, diagnostics.

Messaging: contacts, external identities, conversations, external links, messages, delivery statuses, handoffs.

AI/knowledge: profiles, prompt versions, states, executions, tools, sources, documents, chunks, import jobs.

Business: locations, hours, services, schedules, prices, leads, appointment requests.

Billing: plans, entitlements, tenant assignments, Stripe customers/subscriptions/prices/events/invoices, usage.

Platform: webhook events, deliveries, idempotency, audit, product events, feature flags, support grants, exports, deletions.

## Tenancy

Every directly tenant-owned row has `tenant_id NOT NULL`. Add tenant-aware foreign keys and selective RLS. Application services always require tenant context.

## Uniqueness

Constrain provider event IDs, provider message IDs by connection, Chatwoot message IDs by account, Stripe event IDs, and operation idempotency keys.

## Encryption

Use AES-256-GCM with versioned master keys, unique nonce, and tenant-bound authenticated metadata.

## Migrations

Commit migrations, analyze locks, back up before high-risk changes, maintain rollback/roll-forward notes, and never change enums without compatibility analysis.
