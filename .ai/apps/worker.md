# apps/worker

BullMQ worker process.

## Current implementation

- Listens to `realwise-message-processing`.
- Loads persisted message, conversation, tenant and knowledge sources.
- Runs deterministic assistant decision policy.
- Upserts `assistant_decisions` by message ID.
- Creates `chatwoot_message_mirrors` records for `HANDOFF` decisions when a tenant has a Chatwoot installation.
- Marks matching webhook event as processed.

## Local run

```bash
DATABASE_URL=postgres://realwise:realwise@localhost:5432/realwise_aichat \
REDIS_URL=redis://localhost:6379 \
pnpm --filter @realwise/worker dev
```
