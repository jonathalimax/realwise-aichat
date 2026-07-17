# apps/web

Next.js App Router customer UI.

## Current implementation

- `src/app/page.tsx` renders a responsive Portuguese dashboard.
- Uses shared primitives from `@realwise/ui`.
- Initial dashboard is static/demo-shaped; API integration is next.

## Rules

- Server components by default.
- No tokens in localStorage.
- Customer-visible copy must be Brazilian Portuguese.
- Display operational status and next action before advanced diagnostics.
