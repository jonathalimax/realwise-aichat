# packages

- `contracts`: Zod schemas and shared types.
- `config`: environment validation and activation status helpers.
- `database`: Drizzle schema, baseline migration, seed script, tenant-owned data and idempotency constraints.
- `auth`: password hashing, verification, session-token hashing and role assertion primitives.
- `encryption`: AES-256-GCM JSON encryption with tenant-bound AAD.
- `meta`: mock Meta event normalization and OAuth state helpers.
- `knowledge`: chunking and deterministic assistant decision policy.
- `queue`: BullMQ queue names, job contracts and default retry options.
- `ui`: shared accessible UI primitives.
- Remaining packages are placeholders for expansion while preserving architecture boundaries.
