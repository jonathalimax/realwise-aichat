FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/chat ./apps/chat
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
RUN pnpm --filter @realwise/chat build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /repo/apps/chat/.next/standalone ./
COPY --from=build /repo/apps/chat/.next/static ./apps/chat/.next/static
COPY --from=build /repo/apps/chat/public ./apps/chat/public
WORKDIR /repo/apps/chat
EXPOSE 3000
CMD ["node", "server.js"]
