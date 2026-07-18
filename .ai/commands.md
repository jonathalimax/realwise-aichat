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
pnpm --filter @realwise/api dev
pnpm --filter @realwise/worker dev
pnpm smoke:api
pnpm e2e:local
```

## Local services

Docker is verified through Colima on macOS:

```bash
colima start --arch aarch64 --vm-type vz --mount-type virtiofs
docker context use colima
docker compose -f infrastructure/docker/docker-compose.yml up -d postgres redis
pnpm --filter @realwise/database db:migrate
pnpm --filter @realwise/database db:seed
```

## App ports

- `apps/web`: http://localhost:3000
- `apps/api`: http://localhost:3001/api
- `apps/mock-meta`: http://localhost:3010
