# CI

Status: IMPLEMENTED_NOT_VERIFIED

Implemented:

- GitHub Actions workflow with Node 22 and pnpm 10.30.1.
- PostgreSQL pgvector and Redis service containers.
- Installs `postgresql-client` for direct smoke DB assertions.
- Runs migrations and seed.
- Runs `pnpm check`.
- Installs Playwright Chromium dependencies.
- Starts API and worker for `pnpm smoke:api`.
- Runs `pnpm e2e:local`.

Local caveat:

- The smoke script supports both local Docker Compose DB queries and CI direct `psql` queries via `USE_DIRECT_PSQL=1`.

Next:

- Observe the first GitHub Actions run after push and adjust if hosted runner image pulls or browser deps fail.
