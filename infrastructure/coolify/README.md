# Coolify Deployment

Deploy `apps/web`, `apps/api`, `apps/worker`, PostgreSQL and Redis as separate services.

## Required production secrets

- `DATABASE_URL`
- `REDIS_URL`
- `SESSION_SECRET`
- `ENCRYPTION_MASTER_KEYS`
- `CHATWOOT_BASE_URL`
- `CHATWOOT_PLATFORM_TOKEN`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `META_APP_ID`
- `META_APP_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN`

Do not mark external integrations as production verified until real provider evidence is captured.
