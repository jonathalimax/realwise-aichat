FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/marketing ./apps/marketing
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
RUN pnpm --filter @realwise/marketing build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /repo/apps/marketing/.next/standalone ./
COPY --from=build /repo/apps/marketing/.next/static ./apps/marketing/.next/static
COPY --from=build /repo/apps/marketing/public ./apps/marketing/public
WORKDIR /repo/apps/marketing
EXPOSE 3007
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
