FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile=false
ARG APP
ENV APP=${APP}
RUN pnpm --filter @realwise/${APP} build
EXPOSE 3000 3001
CMD ["sh", "-lc", "pnpm --filter @realwise/${APP} dev"]
