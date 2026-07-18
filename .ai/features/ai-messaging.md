# AI Messaging

Status: MOCK_VERIFIED

`packages/knowledge` includes deterministic assistant decisions: hand off to humans on request, pause when disabled, cite tenant sources, and never falsely confirm appointments.

Current API behavior:

- `POST /api/webhooks/meta/mock` normalizes mock Meta events.
- When `DATABASE_URL` is configured, mock webhook events are persisted idempotently by provider event ID.
- Contacts, conversations and messages are upserted tenant-scoped.
- API enqueues `realwise-message-processing` BullMQ jobs instead of processing assistant decisions inline.
- `apps/worker` processes jobs, retrieves tenant/conversation/knowledge, records `assistant_decisions`, and marks webhook events processed.
- Assistant decisions use tenant knowledge sources when available.
- Duplicate provider events return `duplicate: true` without reprocessing.
