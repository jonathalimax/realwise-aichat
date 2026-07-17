# Coding-Agent Instructions

Read `MASTER_PLAN.md`, `docs/README.md`, `MANUAL_ACTIONS.md`, and `docs/28-definition-of-done.md` before implementation.

## Non-negotiable rules

- Verify current official provider documentation; never invent endpoints, scopes, payloads, token lifetimes, or webhook behavior.
- Every tenant-owned record and query must be tenant scoped.
- Add a Tenant A versus Tenant B test for every tenant-facing feature.
- Never log secrets, authorization codes, card data, full documents, or full customer messages.
- Preserve raw bodies only where signature verification requires it.
- External events must be idempotent and asynchronously processed.
- Stripe redirects do not grant access; verified webhooks update local entitlements.
- Model output cannot execute arbitrary URLs, commands, workflows, or queries.
- Chatwoot is the inbox; Realwise owns Meta.
- Do not expose Chatwoot Platform, Meta, Stripe, or n8n secrets to tenant users.
- Do not run production Ollama on the initial small VPS without capacity evidence.

## Expected commands

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:security
pnpm test:a11y
pnpm build
pnpm verify
pnpm db:migrate
pnpm db:seed
pnpm docker:up
pnpm docker:down
```

A task requires tests, authorization, error handling, observability, documentation, and manual-action notes—not only compiling code.
