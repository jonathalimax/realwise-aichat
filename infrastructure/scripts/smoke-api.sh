#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:3001/api}"
TENANT_NAME="${TENANT_NAME:-Academia Realwise Demo}"
DB_COMPOSE_FILE="${DB_COMPOSE_FILE:-infrastructure/docker/docker-compose.yml}"

curl -fsS "$API_URL/health/live" >/tmp/realwise-aichat-health.json

LOGIN_HEADERS=/tmp/realwise-aichat-login-headers.txt
LOGIN_BODY=/tmp/realwise-aichat-login-body.json
curl -fsS -D "$LOGIN_HEADERS" -o "$LOGIN_BODY" \
  -H 'content-type: application/json' \
  -X POST "$API_URL/auth/login" \
  --data '{"email":"owner@realwise.local","password":"change-me-demo-password"}'

COOKIE=$(grep -i '^set-cookie:' "$LOGIN_HEADERS" | sed -E 's/^set-cookie: ([^;]+).*/\1/i' | tr -d '\r' | head -1)
TENANT_ID=$(docker compose -f "$DB_COMPOSE_FILE" exec -T postgres psql -U realwise -d realwise_aichat -tAc "select id from tenants where name='$TENANT_NAME' limit 1")
CONNECTION_ID=$(docker compose -f "$DB_COMPOSE_FILE" exec -T postgres psql -U realwise -d realwise_aichat -tAc "select id from channel_connections where tenant_id='$TENANT_ID' and provider='WHATSAPP' limit 1")

curl -fsS -H "cookie: $COOKIE" -H "x-tenant-id: $TENANT_ID" "$API_URL/dashboard/summary" >/tmp/realwise-aichat-dashboard.json
curl -fsS -H "cookie: $COOKIE" -H "x-tenant-id: $TENANT_ID" "$API_URL/channels" >/tmp/realwise-aichat-channels.json
curl -fsS -H "cookie: $COOKIE" -H "x-tenant-id: $TENANT_ID" -H 'content-type: application/json' -X POST "$API_URL/channels/connect-mock" --data '{"provider":"FACEBOOK","externalAssetId":"mock-facebook-smoke"}' >/tmp/realwise-aichat-channel-connect.json
curl -fsS -H "cookie: $COOKIE" -H "x-tenant-id: $TENANT_ID" "$API_URL/chatwoot/status" >/tmp/realwise-aichat-chatwoot.json
curl -fsS -H "cookie: $COOKIE" -H "x-tenant-id: $TENANT_ID" -H 'content-type: application/json' -X POST "$API_URL/chatwoot/provision-mock" >/tmp/realwise-aichat-chatwoot-provision.json
curl -fsS -H "cookie: $COOKIE" -H "x-tenant-id: $TENANT_ID" "$API_URL/knowledge/sources" >/tmp/realwise-aichat-knowledge.json
curl -fsS -H "cookie: $COOKIE" -H "x-tenant-id: $TENANT_ID" "$API_URL/billing/entitlements" >/tmp/realwise-aichat-billing.json
curl -fsS -H "cookie: $COOKIE" -H "x-tenant-id: $TENANT_ID" \
  -H 'content-type: application/json' \
  -X POST "$API_URL/leads" \
  --data '{"contactName":"Smoke Test","service":"Jiu-jitsu","preferredTime":"Segunda 19h","notes":"Criado pelo smoke test"}' >/tmp/realwise-aichat-lead.json

EVENT_ID="smoke-$(date +%s)"
PAYLOAD="{\"tenantId\":\"$TENANT_ID\",\"connectionId\":\"$CONNECTION_ID\",\"provider\":\"WHATSAPP\",\"eventId\":\"$EVENT_ID\",\"messageId\":\"msg-$EVENT_ID\",\"conversationId\":\"conv-smoke\",\"contactId\":\"contact-smoke\",\"text\":\"Quero agendar uma aula experimental\"}"
curl -fsS -H 'content-type: application/json' -X POST "$API_URL/webhooks/meta/mock" --data "$PAYLOAD" >/tmp/realwise-aichat-webhook.json
curl -fsS -H 'content-type: application/json' -X POST "$API_URL/webhooks/meta/mock" --data "$PAYLOAD" >/tmp/realwise-aichat-webhook-duplicate.json

python3 - <<'PY'
import json
from pathlib import Path
for name in ['health','login-body','dashboard','channels','channel-connect','chatwoot','chatwoot-provision','knowledge','billing','lead','webhook','webhook-duplicate']:
    path = Path(f'/tmp/realwise-aichat-{name}.json')
    data = json.loads(path.read_text())
    print(name, json.dumps(data, ensure_ascii=False)[:500])
PY
