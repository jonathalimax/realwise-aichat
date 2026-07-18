import { defineConfig, devices } from "@playwright/test";

const databaseUrl = "postgres://realwise:realwise@localhost:5432/realwise_aichat";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: `cd apps/api && DATABASE_URL=${databaseUrl} REDIS_URL=redis://localhost:6379 SESSION_SECRET=change-me-at-least-32-chars-local ENCRYPTION_MASTER_KEYS=v1:BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc= pnpm dev`,
      url: "http://localhost:3001/api/health/live",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "cd apps/web && NEXT_PUBLIC_API_URL=http://localhost:3001/api pnpm dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
