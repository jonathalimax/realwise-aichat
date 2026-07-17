# Coolify Deployment

## Domains

- `aichat.realwise.com.br`: web and API
- `inbox.aichat.realwise.com.br`: Chatwoot

## Services

```text
realwise-web
realwise-api
realwise-worker
postgres
redis
chatwoot-web
chatwoot-worker
```

Ollama is an optional separate-host profile.

## Isolation and persistence

Only web/API and Chatwoot are public. PostgreSQL, Redis, workers, and internal integration endpoints remain private where possible. Use separate Realwise and Chatwoot databases/users. Persist databases and Chatwoot attachments.

## Sequence

1. Configure DNS/TLS.
2. Create project, private network, and volumes.
3. Add validated secrets.
4. Deploy PostgreSQL and Redis.
5. Create databases and users.
6. Deploy Chatwoot and run setup.
7. Create Chatwoot Platform App.
8. Deploy API and worker.
9. Run migrations.
10. Deploy web.
11. Verify health.
12. Run mock smoke tests.
13. Configure provider callbacks.
14. Enable external features gradually.

## Controls

Pinned images, health checks, restart policies, resource limits, graceful shutdown, migration job, log rotation, backups, disk alerts, rollback, and previous image retention.

Do not enable local production inference until capacity tests prove it safe.
