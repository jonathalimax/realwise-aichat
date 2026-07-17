# Architecture

## Runtime topology

```text
Meta APIs / mock-meta -> apps/api -> normalized messaging -> AI/knowledge/tools -> Chatwoot adapter -> humans
                                      -> leads/appointments -> billing/analytics/support
apps/worker processes durable jobs through BullMQ/Redis.
```

## Stack

- TypeScript, pnpm workspaces, Turborepo.
- Next.js App Router for `apps/web`.
- NestJS for `apps/api`.
- BullMQ/Redis for async jobs.
- PostgreSQL + pgvector target with Drizzle schema in `packages/database`.
- AES-256-GCM credential encryption in `packages/encryption`.
- Zod contracts in `packages/contracts`.

## Current state

This repo is a production-shaped MVP scaffold. It includes deterministic mocks and integration seams, but no provider is `PRODUCTION_VERIFIED` until real evidence is captured.

## Tenant isolation

Every tenant-owned database table must have `tenant_id`. Application services must require tenant context before reading or mutating tenant data.
