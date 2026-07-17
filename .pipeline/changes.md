# Changes

## Changed files

- Added Drizzle config and baseline SQL migration.
- Added sessions and invitations to the database schema.
- Added demo seed script.
- Implemented `@realwise/auth` primitives and tests.
- Added API auth service/controller.
- Added API database provider and tenant context decorator.
- Made dashboard, knowledge and leads endpoints DB-aware and tenant-scoped.
- Updated `.ai/` app/feature/command docs.

## Behavior changes

- API can bootstrap an owner + tenant, login, resolve current session and logout when `DATABASE_URL` is configured.
- Knowledge and leads can be created for a tenant using header-based tenant context.
- Dashboard summary reads tenant/channel/knowledge/lead counts from DB when configured; otherwise demo mode remains available.
- Tenant-owned dashboard, knowledge and leads routes require a valid `rw_session` cookie and tenant membership when DB is configured.

## Migration notes

- Apply `packages/database/drizzle/0000_initial.sql` with `pnpm --filter @realwise/database db:migrate` after starting PostgreSQL.
- Demo seed credentials: `owner@realwise.local` / `change-me-demo-password`.

## Follow-ups

- Add invite acceptance, email verification/reset and MFA.
- Add RLS policies and tenant isolation tests.
- Wire mock webhook persistence and queue processing.
