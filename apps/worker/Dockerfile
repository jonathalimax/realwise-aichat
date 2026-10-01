FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
RUN pnpm --filter @realwise/db exec prisma generate
RUN pnpm --filter @realwise/worker build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/worker/dist ./apps/worker/dist
COPY --from=build /repo/apps/worker/node_modules ./apps/worker/node_modules
WORKDIR /repo/apps/worker
CMD ["node", "dist/index.js"]
