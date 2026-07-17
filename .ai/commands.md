# Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm --filter @realwise/database db:migrate
pnpm --filter @realwise/database db:seed
```

## Local services

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

## App ports

- `apps/web`: http://localhost:3000
- `apps/api`: http://localhost:3001/api
- `apps/mock-meta`: http://localhost:3010
