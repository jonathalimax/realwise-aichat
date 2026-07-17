# Pipeline Spec

## Request summary

Plan and implement the Realwise AI Chat system under `~/Developer/personal/realwise-aichat`, organize the project with `.ai/` context like Realwise, and prepare it for push to `https://github.com/jonathalimax/realwise-aichat.git`.

## `.ai/` context files read

- Existing Realwise `.ai/README.md`
- Existing Realwise `.ai/project.md`
- Existing Realwise `.ai/pipelines/handoff-template.md`
- Realwise AI Chat `MASTER_PLAN.md`
- Realwise AI Chat `docs/01-product-requirements.md`
- Realwise AI Chat `docs/03-design-system.md`
- Realwise AI Chat `docs/05-frontend.md`
- Realwise AI Chat `docs/06-backend.md`
- Realwise AI Chat `docs/07-database.md`
- Realwise AI Chat `docs/reference/api-contracts.md`

## Affected apps/features

- Monorepo root, workspace, CI and deployment.
- `apps/web`, `apps/api`, `apps/worker`, `apps/mock-meta`.
- Shared packages for contracts, config, database, encryption, meta, knowledge and UI.
- `.ai/` project map and feature docs.

## Implementation plan

1. Scaffold pnpm/Turborepo TypeScript workspace.
2. Add shared contracts and release-state model.
3. Add tenant-aware database schema and encryption helper.
4. Add deterministic AI/knowledge and mock Meta normalization.
5. Build status-first Portuguese dashboard.
6. Build NestJS API skeleton with health, dashboard, knowledge, leads, billing and mock webhook endpoints.
7. Add worker/mock provider services.
8. Add Docker/Coolify/CI and pipeline handoff docs.
9. Install dependencies, run validation, initialize git and push.

## API/data/auth impacts

- API is scaffolded with demo/static behavior; real persistence/auth enforcement is next.
- Database schema includes users, tenants, memberships, channels, conversations, messages, knowledge, leads, webhook events and audit events.
- Auth flows are not production-ready in this pass.

## Validation plan

- `pnpm install`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build` where feasible

## Open questions

None blocking for local scaffold. External secrets and production activation remain manual.
