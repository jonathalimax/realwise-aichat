# Test Results

## Commands run

- `docker context use colima` — PASS.
- `docker info` — PASS through Colima.
- `docker compose -f infrastructure/docker/docker-compose.yml up -d postgres redis` — PASS.
- `pnpm --filter @realwise/database db:migrate` against Colima PostgreSQL — PASS, including `0008_email_outbox.sql`.
- `pnpm install` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm test` — PASS.
- `pnpm build` — PASS.
- API dev server against Colima DB/Redis — PASS.
- Worker dev process against Colima DB/Redis — PASS.
- `pnpm smoke:api` against live API + worker + Colima DB/Redis — PASS, including live dependency health checks, standardized validation errors, auth, invite, role-forbidden RBAC check, email verification, password reset, email outbox, audit listing, dashboard, channels, mock channel connect, Chatwoot mock provisioning, knowledge, billing entitlements, billing checkout/portal mock sessions, leads, mock webhook enqueue, worker processing, assistant decision persistence, idempotent usage metering and Chatwoot mock mirror persistence.
- `pnpm e2e:local` — PASS, Playwright Chromium verifies login, dashboard, channels, knowledge creation, leads and billing console tabs.

## Current iteration

- Added `email_outbox` persistence.
- Auth invite, email verification and password reset flows write mock/manual email records.
- Smoke verifies `INVITATION`, `EMAIL_VERIFICATION` and `PASSWORD_RESET` outbox records.

## Commands not run

- Real provider integration tests: credentials and external activation not available.
