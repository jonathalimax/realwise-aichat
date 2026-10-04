FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/inference-gateway ./apps/inference-gateway
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
RUN pnpm --filter @realwise/db exec prisma generate
RUN pnpm --filter @realwise/inference-gateway build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/inference-gateway/dist ./apps/inference-gateway/dist
COPY --from=build /repo/apps/inference-gateway/node_modules ./apps/inference-gateway/node_modules
WORKDIR /repo/apps/inference-gateway
RUN npm install -g tsx
EXPOSE 3002
CMD ["tsx", "dist/server.js"]
