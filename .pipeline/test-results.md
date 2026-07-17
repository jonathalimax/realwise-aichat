# Test Results

## Commands run

- `pnpm install` — PASS
- `pnpm typecheck` — PASS
- `pnpm test` — PASS
- `pnpm build` — PASS
- Docker restart attempts — FAILED to restore Docker daemon.

## Current iteration

- Added migration tooling, baseline SQL migration, demo seed, auth primitives, auth endpoints and DB-backed tenant-scoped dashboard/knowledge/leads endpoints.
- Added cookie-session tenant guard for DB-configured tenant routes.
- Added invite creation and invite acceptance endpoints.
- Added email verification and password reset token endpoints with non-production manual token return.
- Added idempotent mock webhook persistence for webhook events, contacts, conversations and messages.

## Blocked command

- Live local DB migration/seed verification is blocked by local Docker daemon/image state:
  - `docker info` hangs or reports daemon unavailable after Docker Desktop restart attempts.
  - Previous image pulls failed for `redis:7-alpine` and `pgvector/pgvector:pg16` with `unexpected end of JSON input`.

## Commands not run

- `pnpm --filter @realwise/database db:migrate` against a live database: blocked by Docker daemon/image state.
- End-to-end browser tests: not yet implemented.
- Real provider integration tests: credentials and external activation not available.
