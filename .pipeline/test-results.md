# Test Results

## Commands run

- `docker context use colima` — PASS.
- `docker info` — PASS through Colima.
- `docker compose -f infrastructure/docker/docker-compose.yml up -d postgres redis` — PASS.
- `pnpm --filter @realwise/database db:migrate` against Colima PostgreSQL — PASS, including `0006_chatwoot_message_mirrors.sql`.
- `pnpm install` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm test` — PASS.
- `pnpm build` — PASS.
- API dev server against Colima DB/Redis — PASS.
- Worker dev process against Colima DB/Redis — PASS.
- `pnpm smoke:api` against live API + worker + Colima DB/Redis — PASS, including auth, dashboard, channels, mock channel connect, Chatwoot mock provisioning, knowledge, billing entitlements, billing checkout/portal mock sessions, leads, mock webhook enqueue, worker processing, assistant decision persistence, idempotent usage metering and Chatwoot mock mirror persistence.
- `pnpm e2e:local` — PASS, Playwright Chromium verifies login, dashboard, channels, knowledge creation, leads and billing console tabs.

## Current iteration

- Added `chatwoot_message_mirrors` persistence.
- Worker now creates mock Chatwoot mirror records for `HANDOFF` assistant decisions.
- Worker now records idempotent `MESSAGE_PROCESSED` usage events for billing/usage reporting.
- Dashboard and billing endpoints read real message usage totals.
- Added persisted mock billing checkout/portal sessions and smoke coverage.
- Smoke webhook text now exercises the human handoff path and verifies the mirror and usage records.

## Commands not run

- Real provider integration tests: credentials and external activation not available.
