# Frontend Architecture

## Stack

Next.js App Router, strict TypeScript, server components by default, accessible primitives, shared Zod contracts, Playwright, and Brazilian Portuguese localization.

## Rendering

- Static generation for public pages where useful.
- Server-side session and tenant membership validation.
- Client guards are never the only authorization.
- Long-running operations expose job state.
- Sensitive mutations require CSRF and explicit authorization.

## State

Use URL state for filters and pagination. Avoid a global client store without a clear need. Server responses remain authoritative.

## Errors

Show plain explanation, safe support code, retry when safe, and diagnostics link for authorized users. Never show stack traces, secrets, or provider payload dumps.

## Forms

Use server validation, field errors, linked summary, focus management, duplicate-submit prevention, unsaved-change protection, and clear destructive confirmations.

## Performance

Paginate, defer non-critical analytics, minimize client JS, avoid large documents in browser payloads, and cache only with tenant-safe keys.

## Security

No auth tokens in localStorage. No arbitrary HTML from imported sources. No direct client access to Stripe secret APIs, Meta secrets, Chatwoot Platform APIs, or n8n.
