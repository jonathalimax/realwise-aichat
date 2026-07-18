# End-to-End Tests

Status: MOCK_VERIFIED

Implemented:

- Playwright config at `playwright.config.ts`.
- `pnpm e2e:local` migrates/seeds the local Colima PostgreSQL database before running browser tests.
- `tests/e2e/app-console.spec.ts` verifies operator login and core console flows:
  - dashboard load
  - channel mock connect
  - knowledge creation
  - leads tab
  - billing tab

Requirements:

- Colima Docker context running with PostgreSQL and Redis services.
- Browser installed via `pnpm exec playwright install chromium`.
