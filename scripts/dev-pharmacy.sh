#!/usr/bin/env bash
# Starts the whole pharmacy system locally (LOCAL ONLY): checks Postgres/Redis, applies migrations to the
# local database, seeds the demo pharmacy, then starts API, worker, dashboard, chat widget and marketing.
# Ctrl-C stops everything this script started (never Postgres/Redis).
#
#   scripts/dev-pharmacy.sh            normal start
#   RESET_DEMO=1 scripts/dev-pharmacy.sh   recreate the demo pharmacy's data first
#   WITH_GATEWAY=1 scripts/dev-pharmacy.sh also start the inference gateway (needs a model: see docs/pharmacy/LOCAL.md)
#   WITH_ADMIN=1 scripts/dev-pharmacy.sh   also start the platform admin app (:3004)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:$PATH"
LOGS="$ROOT/.local-logs"
mkdir -p "$LOGS"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ -f .env ] || die "Missing $ROOT/.env (git-ignored). See docs/pharmacy/LOCAL.md, section Prerequisites."
set -a; . ./.env; set +a

# ---- local-only guard
DB_HOST="$(node -e 'try{console.log(new URL(process.env.DATABASE_URL).hostname.replace(/^\[|\]$/g,""))}catch{console.log("")}')"
case "$DB_HOST" in localhost|127.0.0.1|::1) ;; *) die "DATABASE_URL host is '$DB_HOST'. This script only runs against a local database." ;; esac

# ---- Postgres + Redis
say "Checking Postgres and Redis..."
if ! (command -v pg_isready >/dev/null && pg_isready -q -h localhost -p 5432) ; then
  say "Starting Postgres and Redis with brew services (they keep running until you stop them)..."
  brew services run postgresql@17 >/dev/null 2>&1 || true
  brew services run redis >/dev/null 2>&1 || true
  for i in $(seq 1 20); do pg_isready -q -h localhost -p 5432 && break; sleep 1; done
fi
pg_isready -q -h localhost -p 5432 || die "Postgres is not answering on localhost:5432 (try: brew services run postgresql@17 redis)."
if command -v redis-cli >/dev/null && ! redis-cli -h localhost ping >/dev/null 2>&1; then
  brew services run redis >/dev/null 2>&1 || true; sleep 2
fi
redis-cli -h localhost ping >/dev/null 2>&1 || die "Redis is not answering on localhost:6379 (try: brew services run redis)."

# ---- ports must be free (otherwise a stale server would serve old code)
BUSY=""
for port in 3003 3005 3006 3007; do
  if lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1; then BUSY="$BUSY $port"; fi
done
[ -z "$BUSY" ] || die "Ports already in use:$BUSY. Stop whatever runs there (lsof -iTCP:<port> -sTCP:LISTEN) and retry."

# ---- migrations (additive only; never reset) + prisma client
say "Applying migrations to the local database (prisma migrate deploy)..."
(cd packages/db && npx prisma migrate deploy) >"$LOGS/migrate.log" 2>&1 || { tail -20 "$LOGS/migrate.log"; die "migrate deploy failed (log: $LOGS/migrate.log)"; }
tail -3 "$LOGS/migrate.log"

say "Seeding the demo pharmacy..."
SEED_ARGS=""; [ "${RESET_DEMO:-0}" = "1" ] && SEED_ARGS="-- --reset"
(cd apps/api && pnpm run seed:pharmacy $SEED_ARGS) >"$LOGS/seed.log" 2>&1 || { tail -20 "$LOGS/seed.log"; die "seed failed (log: $LOGS/seed.log)"; }
tail -1 "$LOGS/seed.log"

# ---- start apps, each in its own process group so Ctrl-C can stop the whole tree
set -m
PIDS=()
start() { # name dir cmd...
  local name="$1" dir="$2"; shift 2
  (cd "$dir" && exec "$@") >"$LOGS/$name.log" 2>&1 &
  PIDS+=($!)
  echo "  started $name (pid $!, log .local-logs/$name.log)"
}
cleanup() {
  trap - INT TERM EXIT
  echo; say "Stopping what this script started..."
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill -TERM -- "-$pid" 2>/dev/null; done
  sleep 2
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill -KILL -- "-$pid" 2>/dev/null; done
  exit 0
}
trap cleanup INT TERM EXIT

say "Starting apps..."
start api apps/api pnpm dev
start worker apps/worker pnpm dev
start dashboard apps/dashboard env NEXT_PUBLIC_DEFAULT_NICHE=farmacia NEXT_DIST_DIR=.next-farmacia pnpm dev
start chat apps/chat pnpm dev
start marketing apps/marketing pnpm dev
# The model gateway starts automatically when a managed API key is filled in the local .env (same provider as
# real estate: MANAGED_API_KEY / MANAGED_MODEL / INFERENCE_GATEWAY_TOKEN, or OLLAMA_URL). Force with WITH_GATEWAY=1.
if [ "${WITH_GATEWAY:-0}" = "1" ] || grep -qE '^MANAGED_API_KEY=.{8,}' .env 2>/dev/null; then
  start gateway apps/inference-gateway pnpm dev
  GATEWAY_STARTED=1
fi
[ "${WITH_ADMIN:-0}" = "1" ] && start admin apps/admin pnpm dev

wait_http() { # url name seconds
  local i
  for i in $(seq 1 "$3"); do
    if curl -s -o /dev/null --max-time 3 "$1"; then return 0; fi
    sleep 1
  done
  echo "  WARNING: $2 did not answer at $1 within $3s (see .local-logs/)"
  return 1
}
say "Waiting for the servers (the first page load of each Next app compiles it and can take a while)..."
wait_http http://localhost:3006/api/health "API" 90 && echo "  API ok"
wait_http http://localhost:3003/farmacia/app/login "dashboard" 120 && echo "  dashboard ok"
wait_http http://localhost:3005/client/conversation/farmacia-exemplo "chat widget" 120 && echo "  chat ok"
wait_http http://localhost:3007/farmacia "marketing" 120 && echo "  marketing ok"

if [ "${GATEWAY_STARTED:-0}" = "1" ]; then
  MODEL_NOTE="Model gateway started on :3002 (provider from your .env). Check .local-logs/gateway.log if replies look canned."
else
  MODEL_NOTE="No model key in .env: the chat uses its deterministic paths. Fill MANAGED_API_KEY (see docs/pharmacy/LOCAL.md) and rerun."
fi

cat <<URLS

========================================================================
 Farmácia Exemplo is running (local only)
------------------------------------------------------------------------
 Dashboard      http://localhost:3003/farmacia/app/login
 Chat widget    http://localhost:3005/client/conversation/farmacia-exemplo
 Landing page   http://localhost:3007/farmacia
 API health     http://localhost:3006/api/health
 Logs           .local-logs/*.log

 Logins (password for all: Farmacia@2026)
   Proprietário   dono@farmaciaexemplo.test
   Farmacêutica   farmaceutica@farmaciaexemplo.test   (CRF-PR 12345)
   Gerente        gerente@farmaciaexemplo.test
   Atendente      atendente@farmaciaexemplo.test
   Entregador     entregador@farmaciaexemplo.test

 ${MODEL_NOTE}
 Press Ctrl-C to stop everything.
========================================================================
URLS
wait
