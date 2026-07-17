# Changes

## Changed files

- Added pnpm/Turborepo workspace root files.
- Added `apps/web`, `apps/api`, `apps/worker`, `apps/mock-meta`.
- Added shared packages under `packages/`.
- Added `.ai/` project map, app docs and feature docs.
- Added Docker/Coolify infrastructure and GitHub Actions CI.
- Added `.pipeline/` handoff files.

## Behavior changes

- Project is now a buildable monorepo with a Portuguese customer dashboard.
- API exposes health, dashboard, knowledge, leads, billing and mock Meta webhook endpoints.
- Deterministic AI decision helper handles handoff, pause and appointment-request safety.
- Tenant-bound AES-256-GCM encryption helper is tested.

## Docs updated

- `.ai/README.md`, `project.md`, `architecture.md`, `conventions.md`, `commands.md`, `feature-map.md`.
- `.ai/apps/*` and `.ai/features/*`.
- `.pipeline/*`.

## Migration notes

No database migration runner is included yet. `packages/database/src/schema.ts` defines the target Drizzle schema.

## Follow-ups

- Implement real auth/session/MFA flows.
- Add migrations and RLS policies.
- Wire API to database and queues.
- Activate Chatwoot, Stripe and Meta with real credentials and evidence.
- Add Playwright E2E and provider sandbox tests.
