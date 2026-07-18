# apps/web

Next.js App Router customer UI.

## Current implementation

- `src/app/page.tsx` renders a responsive Portuguese marketing/demo dashboard.
- `src/app/app/page.tsx` is a tabbed operational console that logs into the API and manages overview, channels, Chatwoot, knowledge, leads and billing from PostgreSQL-backed endpoints.
- Uses shared primitives from `@realwise/ui`.

## Rules

- Server components by default.
- No tokens in localStorage.
- Customer-visible copy must be Brazilian Portuguese.
- Display operational status and next action before advanced diagnostics.
