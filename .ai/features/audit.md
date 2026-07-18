# Audit

Status: MOCK_VERIFIED

Implemented:

- `audit_events` already exists in the baseline schema.
- `AuditService` records tenant/user actions when a database is configured.
- `GET /api/audit/events` returns the latest tenant audit events behind the session tenant guard.
- Current audited actions include:
  - mock channel connection
  - knowledge source creation
  - billing session creation
- API smoke verifies audit listing.

Next:

- Add audit coverage for every privileged mutation.
- Add platform-support read paths with sanitized metadata.
- Add retention/export policy.
