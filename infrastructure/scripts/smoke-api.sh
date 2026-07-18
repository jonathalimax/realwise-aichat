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
curl -fsS -H "cookie: $COOKIE" -H "x-tenant-id: $TENANT_ID" -H 'content-type: application/json' -X POST "$API_URL/billing/checkout-session" >/tmp/realwise-aichat-billing-checkout.json
curl -fsS -H "cookie: $COOKIE" -H "x-tenant-id: $TENANT_ID" -H 'content-type: application/json' -X POST "$API_URL/billing/portal-session" >/tmp/realwise-aichat-billing-portal.json
INVALID_STATUS=$(curl -sS -o /tmp/realwise-aichat-invalid.json -w '%{http_code}' -H 'content-type: application/json' -X POST "$API_URL/auth/login" --data '{"email":"not-an-email","password":"x"}')
if [ "$INVALID_STATUS" != "400" ]; then echo "expected invalid login to return 400, got $INVALID_STATUS" >&2; cat /tmp/realwise-aichat-invalid.json >&2; exit 1; fi
curl -fsS -H "cookie: $COOKIE" -H "x-tenant-id: $TENANT_ID" -H 'content-type: application/json' -X POST "$API_URL/auth/invite" --data '{"email":"invited-smoke@realwise.local","role":"ATTENDANT"}' >/tmp/realwise-aichat-invite.json
INVITE_TOKEN=$(python3 - <<'PY'
import json
print(json.load(open('/tmp/realwise-aichat-invite.json'))['inviteToken'])
PY
)
ATTENDANT_HEADERS=/tmp/realwise-aichat-attendant-headers.txt
curl -fsS -D "$ATTENDANT_HEADERS" -o /tmp/realwise-aichat-accept-invite.json -H 'content-type: application/json' -X POST "$API_URL/auth/accept-invite" --data "{\"inviteToken\":\"$INVITE_TOKEN\",\"name\":\"Smoke Attendant\",\"password\":\"change-me-attendant\"}"
ATTENDANT_COOKIE=$(grep -i '^set-cookie:' "$ATTENDANT_HEADERS" | sed -E 's/^set-cookie: ([^;]+).*/\1/i' | tr -d '\r' | head -1)
FORBIDDEN_STATUS=$(curl -sS -o /tmp/realwise-aichat-forbidden.json -w '%{http_code}' -H "cookie: $ATTENDANT_COOKIE" -H "x-tenant-id: $TENANT_ID" -H 'content-type: application/json' -X POST "$API_URL/billing/checkout-session")
if [ "$FORBIDDEN_STATUS" != "403" ]; then echo "expected attendant billing checkout to return 403, got $FORBIDDEN_STATUS" >&2; cat /tmp/realwise-aichat-forbidden.json >&2; exit 1; fi
curl -fsS -H 'content-type: application/json' -X POST "$API_URL/auth/request-email-verification" --data '{"email":"owner@realwise.local"}' >/tmp/realwise-aichat-email-verification.json
curl -fsS -H 'content-type: application/json' -X POST "$API_URL/auth/request-password-reset" --data '{"email":"owner@realwise.local"}' >/tmp/realwise-aichat-password-reset.json
OUTBOX_JSON=$(docker compose -f "$DB_COMPOSE_FILE" exec -T postgres psql -U realwise -d realwise_aichat -tAc "select json_object_agg(kind, count)::text from (select kind, count(*)::int from email_outbox where kind in ('INVITATION','EMAIL_VERIFICATION','PASSWORD_RESET') group by kind) t")
printf '%s\n' "$OUTBOX_JSON" >/tmp/realwise-aichat-email-outbox.json
curl -fsS -H "cookie: $COOKIE" -H "x-tenant-id: $TENANT_ID" "$API_URL/audit/events" >/tmp/realwise-aichat-audit.json
curl -fsS -H "cookie: $COOKIE" -H "x-tenant-id: $TENANT_ID" \
  -H 'content-type: application/json' \
  -X POST "$API_URL/leads" \
  --data '{"contactName":"Smoke Test","service":"Jiu-jitsu","preferredTime":"Segunda 19h","notes":"Criado pelo smoke test"}' >/tmp/realwise-aichat-lead.json

EVENT_ID="smoke-$(date +%s)"
PAYLOAD="{\"tenantId\":\"$TENANT_ID\",\"connectionId\":\"$CONNECTION_ID\",\"provider\":\"WHATSAPP\",\"eventId\":\"$EVENT_ID\",\"messageId\":\"msg-$EVENT_ID\",\"conversationId\":\"conv-smoke\",\"contactId\":\"contact-smoke\",\"text\":\"quero falar com atendente\"}"
curl -fsS -H 'content-type: application/json' -X POST "$API_URL/webhooks/meta/mock" --data "$PAYLOAD" >/tmp/realwise-aichat-webhook.json
curl -fsS -H 'content-type: application/json' -X POST "$API_URL/webhooks/meta/mock" --data "$PAYLOAD" >/tmp/realwise-aichat-webhook-duplicate.json

for i in $(seq 1 30); do
  DECISION_JSON=$(docker compose -f "$DB_COMPOSE_FILE" exec -T postgres psql -U realwise -d realwise_aichat -tAc "select json_build_object('action', d.action, 'status', d.status, 'reason', d.reason)::text from assistant_decisions d inner join messages m on m.id=d.message_id where d.tenant_id='$TENANT_ID' and m.external_event_id='$EVENT_ID' limit 1")
  if [ -n "$DECISION_JSON" ]; then
    printf '%s\n' "$DECISION_JSON" >/tmp/realwise-aichat-assistant-decision.json
    break
  fi
  sleep 1
  if [ "$i" = "30" ]; then echo "assistant decision not recorded" >&2; exit 1; fi
done

for i in $(seq 1 30); do
  USAGE_JSON=$(docker compose -f "$DB_COMPOSE_FILE" exec -T postgres psql -U realwise -d realwise_aichat -tAc "select json_build_object('kind', kind, 'quantity', quantity)::text from usage_events where tenant_id='$TENANT_ID' and idempotency_key=(select 'message:' || id::text from messages where external_event_id='$EVENT_ID' limit 1) limit 1")
  if [ -n "$USAGE_JSON" ]; then
    printf '%s\n' "$USAGE_JSON" >/tmp/realwise-aichat-usage-event.json
    break
  fi
  sleep 1
  if [ "$i" = "30" ]; then echo "usage event not recorded" >&2; exit 1; fi
done

for i in $(seq 1 30); do
  MIRROR_JSON=$(docker compose -f "$DB_COMPOSE_FILE" exec -T postgres psql -U realwise -d realwise_aichat -tAc "select json_build_object('status', c.status, 'targetInboxId', c.target_inbox_id)::text from chatwoot_message_mirrors c inner join messages m on m.id=c.message_id where c.tenant_id='$TENANT_ID' and m.external_event_id='$EVENT_ID' limit 1")
  if [ -n "$MIRROR_JSON" ]; then
    printf '%s\n' "$MIRROR_JSON" >/tmp/realwise-aichat-chatwoot-mirror.json
    break
  fi
  sleep 1
  if [ "$i" = "30" ]; then echo "chatwoot mirror not recorded" >&2; exit 1; fi
done

python3 - <<'PY'
import json
from pathlib import Path
for name in ['health','login-body','invalid','dashboard','channels','channel-connect','chatwoot','chatwoot-provision','knowledge','billing','billing-checkout','billing-portal','invite','accept-invite','forbidden','email-verification','password-reset','email-outbox','audit','lead','webhook','webhook-duplicate','assistant-decision','usage-event','chatwoot-mirror']:
    path = Path(f'/tmp/realwise-aichat-{name}.json')
    data = json.loads(path.read_text())
    print(name, json.dumps(data, ensure_ascii=False)[:500])
PY
