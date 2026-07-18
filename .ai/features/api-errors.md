# API Errors

Status: MOCK_VERIFIED

Implemented:

- Global API exception filter.
- Zod validation errors return the shared API error shape:
  - `code`
  - `message`
  - `supportCode`
  - `fieldErrors`
- HTTP exceptions preserve safe app-level `code`/`message` and receive a request-scoped `supportCode`.
- Unhandled errors are logged server-side and returned as `INTERNAL_ERROR` without implementation details.
- Middleware emits `x-request-id` on every API response.
- API smoke verifies invalid login returns a standardized `VALIDATION_ERROR` response.

Next:

- Add structured logger package and request duration metrics.
- Add OpenTelemetry/exporter when deployment target is finalized.
