# Testing Strategy

## Unit

Authorization, entitlements, encryption, OAuth state, signatures, normalization, state transitions, AI decision validation, tool schemas, usage, and retention.

## Integration

Migrations, tenant isolation, Chatwoot provisioning, API inbox bridge, webhook idempotency, retries, dead-letter handling, Stripe lifecycle, imports, vector isolation, and n8n signing.

## End to end

1. Create and verify user.
2. Create tenant.
3. Provision Chatwoot.
4. Connect mock WhatsApp.
5. Receive message.
6. Retrieve knowledge.
7. Send AI reply.
8. Process delivery.
9. Hand off.
10. Respond from Chatwoot.
11. Repeat for Instagram.
12. Repeat for Facebook.
13. Subscribe in Stripe test mode.
14. Verify entitlements and payment failure behavior.
15. Verify Tenant B isolation.

## Mock Meta

Successful and failed login, expired state, inbound messages, statuses, Coexistence human echoes, token expiry/revocation, invalid signatures, duplicates, out-of-order events, provider failure, and rate limits.

## Security

IDOR, role escalation, forged/replayed events, SSRF, malicious uploads, arbitrary n8n selection, secret leakage, loops, and export expiry.

## Accessibility and visual

axe, keyboard, focus, mobile, deterministic screenshots, loading/error/empty/success states.

## Load

Webhook bursts, Stripe retries, conversation list, vector retrieval, and AI saturation.

Reports contain actual command, environment, commit, results, failures, and skipped external verification.
