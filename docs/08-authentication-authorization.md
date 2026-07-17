# Authentication and Authorization

## Authentication

- Email/password with Argon2id
- Email verification
- Password reset
- Server-side sessions
- Optional TOTP
- Recovery codes
- Mandatory MFA for platform admins in production
- Session/device list
- Revoke one or all sessions

Do not implement SMS MFA.

## Sessions

HTTP-only, Secure in production, appropriate SameSite, CSRF protection, rotation after login or privilege change, idle and absolute expiration, server revocation, no credentials in URLs, no tokens in localStorage.

## Roles

Platform:
- PLATFORM_OWNER
- PLATFORM_ADMIN
- PLATFORM_SUPPORT

Tenant:
- TENANT_OWNER
- TENANT_ADMIN
- TENANT_AGENT
- TENANT_VIEWER
- BILLING_ADMIN

Platform and tenant roles are independent.

## Step-up

Require recent reauthentication or MFA before disabling MFA, rotating credentials, disconnecting channels, exporting all data, deleting a tenant, changing billing owner, refunding, changing platform roles, or generating platform tokens.

## Tests

Cross-tenant IDOR, role escalation, platform leakage, revoked session, CSRF, reset replay, verification replay, recovery-code reuse, and step-up expiration.
