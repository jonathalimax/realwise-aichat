FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/dashboard ./apps/dashboard
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
RUN pnpm --filter @realwise/dashboard build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /repo/apps/dashboard/.next/standalone ./
COPY --from=build /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build /repo/apps/dashboard/public ./apps/dashboard/public
WORKDIR /repo/apps/dashboard
EXPOSE 3003
CMD ["node", "server.js"]
