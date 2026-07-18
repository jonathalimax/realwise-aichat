# Role-Based Access Control

Status: MOCK_VERIFIED

Implemented:

- `@RequireRoles(...)` decorator for tenant routes.
- `SessionTenantGuard` verifies active session, tenant membership and required roles.
- Privileged operations require roles:
  - channel mock connect: `OWNER`, `ADMIN`
  - knowledge source create: `OWNER`, `ADMIN`
  - Chatwoot mock provision: `OWNER`, `ADMIN`
  - billing checkout/portal sessions: `OWNER`, `ADMIN`, `BILLING_ADMIN`
- API smoke accepts an invite as `ATTENDANT` and verifies billing checkout returns `ROLE_FORBIDDEN`.

Next:

- Apply explicit roles to all future mutations.
- Add UI hiding/disabling for unauthorized actions after role-aware `/auth/me` UX improvements.
