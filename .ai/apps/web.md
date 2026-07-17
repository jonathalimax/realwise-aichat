# apps/web

Next.js App Router customer UI.

## Current implementation

- `src/app/page.tsx` renders a responsive Portuguese marketing/demo dashboard.
- `src/app/app/page.tsx` logs into the API with the seeded user and loads tenant dashboard data from PostgreSQL.
- Uses shared primitives from `@realwise/ui`.

## Rules

- Server components by default.
- No tokens in localStorage.
- Customer-visible copy must be Brazilian Portuguese.
- Display operational status and next action before advanced diagnostics.
