# apps/api

NestJS REST API.

## Current implementation

- Health endpoints: `/api/health/live`, `/api/health/ready`, `/api/health/dependencies`.
- Auth endpoints: `/api/auth/bootstrap-owner`, `/api/auth/login`, `/api/auth/invite`, `/api/auth/accept-invite`, `/api/auth/request-email-verification`, `/api/auth/verify-email`, `/api/auth/request-password-reset`, `/api/auth/reset-password`, `/api/auth/me`, `/api/auth/logout`.
- Dashboard summary endpoint with DB-backed tenant data when configured.
- Mock Meta webhook normalization, idempotent persistence and fake assistant decision endpoint.
- Tenant-scoped knowledge source list/create and chunk preview endpoints.
- Tenant-scoped leads list/create and billing entitlement demo endpoints.

## Rules

- Add tenant context before real persistence.
- Validate request bodies at boundaries with Zod or DTOs.
- Use safe errors and support codes for customer-facing failures.
