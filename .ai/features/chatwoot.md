# Chatwoot

Status: MOCK_VERIFIED

Implemented:

- `packages/chatwoot` exposes activation-state and mock-installation helpers.
- `chatwoot_installations` persists tenant Chatwoot account/inbox mapping.
- Demo seed creates a mock Chatwoot installation.
- `GET /api/chatwoot/status` returns installation and activation state.
- `POST /api/chatwoot/provision-mock` idempotently provisions mock account/inbox state.
- API smoke covers status and mock provisioning.

Next:

- Real Chatwoot platform API account/inbox provisioning.
- Conversation/message mirroring to Chatwoot.
- Human takeover state synchronization.
