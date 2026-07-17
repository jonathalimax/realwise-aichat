# Auth and Tenancy

Status: IMPLEMENTED_NOT_VERIFIED

Implemented in this iteration:

- Users, tenants, memberships, sessions and invitations in the database schema.
- Baseline SQL migration at `packages/database/drizzle/0000_initial.sql`.
- Drizzle migration commands and demo seed script.
- Password hashing, verification, session-token hashing and role assertion primitives in `@realwise/auth`.
- API endpoints for owner bootstrap, login, invite creation, invite acceptance, current session and logout.
- Cookie-session tenant guard that verifies active session and membership before tenant-owned API access when `DATABASE_URL` is configured.
- Header/demo fallback only when no DB is configured for local preview.

Still next:

- Email verification and reset tokens.
- TOTP/MFA.
- RLS policies and tenant isolation tests.
