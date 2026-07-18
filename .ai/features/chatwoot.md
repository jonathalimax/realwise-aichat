# Chatwoot

Status: MOCK_VERIFIED

Implemented:

- `packages/chatwoot` exposes activation-state and mock-installation helpers.
- `chatwoot_installations` persists tenant Chatwoot account/inbox mapping.
- Demo seed creates a mock Chatwoot installation.
- `GET /api/chatwoot/status` returns installation and activation state.
- `POST /api/chatwoot/provision-mock` idempotently provisions mock account/inbox state.
- API smoke covers status and mock provisioning.
- `chatwoot_message_mirrors` records mock human-handoff mirroring.
- Worker creates mock Chatwoot mirror records when assistant decisions require `HANDOFF`.

Next:

- Real Chatwoot platform API account/inbox provisioning.
- Real conversation/message mirroring to Chatwoot.
- Human takeover state synchronization.
