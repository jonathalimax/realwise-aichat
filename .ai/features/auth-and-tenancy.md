# Auth and Tenancy

Status: IMPLEMENTED_NOT_VERIFIED

Implemented in this iteration:

- Users, tenants, memberships, sessions and invitations in the database schema.
- Baseline SQL migration at `packages/database/drizzle/0000_initial.sql`.
- Drizzle migration commands and demo seed script.
- Password hashing, verification, session-token hashing and role assertion primitives in `@realwise/auth`.
- API endpoints for owner bootstrap, login, current session and logout.
- Header-based tenant context for tenant-scoped API endpoints while full session guard is finalized.

Still next:

- Invite acceptance flow.
- Email verification and reset tokens.
- TOTP/MFA.
- Cookie-session tenant guard that verifies membership on every tenant request.
- RLS policies and tests.
