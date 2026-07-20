# Coolify Deployment

Deploy `apps/web`, `apps/api`, `apps/worker`, PostgreSQL pgvector and Redis as separate resources inside the same Coolify project.

## Resources

| Resource | Type | Public domain | Port |
| --- | --- | --- | --- |
| `realwise-aichat-postgres` | Docker image `pgvector/pgvector:pg16` | none | `5432` internal only |
| `realwise-aichat-redis` | Docker image `redis:7-alpine` | none | `6379` internal only |
| `realwise-aichat-api` | Dockerfile service | `https://aichat.realwise.com.br/api` via custom Traefik labels | `3001` |
| `realwise-aichat-web` | Dockerfile service | `https://aichat.realwise.com.br` | `3000` |
| `realwise-aichat-worker` | Dockerfile service | none | none |

Do not attach HTTP domains to PostgreSQL or Redis. The API and web UI intentionally share one public hostname.

## PostgreSQL pgvector

Image:

```txt
pgvector/pgvector:pg16
```

Environment:

```env
POSTGRES_USER=realwise
POSTGRES_PASSWORD=<secure-password>
POSTGRES_DB=realwise_aichat
```

Persistent storage:

```txt
Name: realwise-aichat-postgres-data
Destination path: /var/lib/postgresql/data
```

Use Coolify-managed source path or a host path dedicated to this resource. Do not reuse another application's database path.

## Redis

Image:

```txt
redis:7-alpine
```

Persistent storage, optional but recommended:

```txt
Name: realwise-aichat-redis-data
Destination path: /data
```

## Application services

Use the same Git repository for API, web and worker:

```txt
https://github.com/jonathalimax/realwise-aichat.git
```

Branch:

```txt
main
```

Dockerfile path:

```txt
infrastructure/docker/node.Dockerfile
```

Build arguments:

```env
APP=api
```

or:

```env
APP=web
```

or:

```env
APP=worker
```

The Dockerfile builds the selected workspace package and starts it with `pnpm --filter @realwise/${APP} start`.

## API routing

Set the API service without a standard Coolify FQDN and add custom Traefik labels so `/api` is forwarded without stripping the prefix. The Nest API already serves routes under `/api`, so Coolify's path-FQDN `StripPrefix` behavior is not appropriate here.

Custom labels for `realwise-aichat-api`:

```txt
traefik.enable=true
traefik.http.routers.realwise-aichat-api-https.rule=Host(`aichat.realwise.com.br`) && PathPrefix(`/api`)
traefik.http.routers.realwise-aichat-api-https.entrypoints=https
traefik.http.routers.realwise-aichat-api-https.tls=true
traefik.http.routers.realwise-aichat-api-https.tls.certresolver=letsencrypt
traefik.http.routers.realwise-aichat-api-https.service=realwise-aichat-api
traefik.http.routers.realwise-aichat-api-https.priority=100
traefik.http.routers.realwise-aichat-api-http.rule=Host(`aichat.realwise.com.br`) && PathPrefix(`/api`)
traefik.http.routers.realwise-aichat-api-http.entrypoints=http
traefik.http.routers.realwise-aichat-api-http.middlewares=redirect-to-https
traefik.http.routers.realwise-aichat-api-http.service=realwise-aichat-api
traefik.http.routers.realwise-aichat-api-http.priority=100
traefik.http.services.realwise-aichat-api.loadbalancer.server.port=3001
```

## API environment

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=postgres://realwise:<secure-password>@<postgres-service-name>:5432/realwise_aichat
REDIS_URL=redis://<redis-service-name>:6379
SESSION_SECRET=<generated-session-secret>
ENCRYPTION_MASTER_KEYS=v1:<base64-32-byte-key>
NEXT_PUBLIC_APP_URL=https://aichat.realwise.com.br
NEXT_PUBLIC_API_URL=https://aichat.realwise.com.br/api
API_URL=https://aichat.realwise.com.br
CHATWOOT_BASE_URL=
CHATWOOT_PLATFORM_TOKEN=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=
AI_PROVIDER=fake
OPENAI_API_KEY=
```

## Web environment

```env
NODE_ENV=production
PORT=3000
NEXT_PUBLIC_APP_URL=https://aichat.realwise.com.br
NEXT_PUBLIC_API_URL=https://aichat.realwise.com.br/api
API_URL=https://aichat.realwise.com.br
```

## Worker environment

```env
NODE_ENV=production
DATABASE_URL=postgres://realwise:<secure-password>@<postgres-service-name>:5432/realwise_aichat
REDIS_URL=redis://<redis-service-name>:6379
SESSION_SECRET=<generated-session-secret>
ENCRYPTION_MASTER_KEYS=v1:<base64-32-byte-key>
NEXT_PUBLIC_APP_URL=https://aichat.realwise.com.br
NEXT_PUBLIC_API_URL=https://aichat.realwise.com.br/api
API_URL=https://aichat.realwise.com.br
CHATWOOT_BASE_URL=
CHATWOOT_PLATFORM_TOKEN=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=
AI_PROVIDER=fake
OPENAI_API_KEY=
```

## Secret generation

Generate the session secret:

```bash
openssl rand -base64 48
```

Generate the encryption key:

```bash
printf "v1:%s\n" "$(openssl rand -base64 32)"
```

Store `ENCRYPTION_MASTER_KEYS` safely. Losing it can make encrypted provider credentials unreadable.

## Migrations

After PostgreSQL and API are deployed, open the API service terminal and run:

```bash
pnpm --filter @realwise/database db:migrate
```

Optionally seed demo data:

```bash
pnpm --filter @realwise/database db:seed
```

Do not seed production if demo users/data should not exist there.

## Verification

```bash
curl -fsS https://aichat.realwise.com.br/api/health/live
curl -fsS https://aichat.realwise.com.br/api/health/ready
curl -fsS https://aichat.realwise.com.br/api/health/dependencies
curl -I https://aichat.realwise.com.br
```

Expected dependency state before external activation:

```json
{
  "database": "ok",
  "redis": "ok",
  "meta": "mock",
  "stripe": "not_configured",
  "chatwoot": "not_configured"
}
```

Do not mark external integrations as production verified until real provider evidence is captured.
