# Health Checks

Status: MOCK_VERIFIED

Implemented:

- `/api/health/live` returns process liveness.
- `/api/health/ready` performs real PostgreSQL and Redis checks when configured.
- `/api/health/dependencies` reports PostgreSQL, Redis, Meta, Stripe and Chatwoot configuration/health.
- API smoke verifies `ready` and `dependencies` against Colima PostgreSQL/Redis.

Next:

- Add latency measurements and structured metrics.
- Add deployment-specific health probes in Coolify once production services are configured.
