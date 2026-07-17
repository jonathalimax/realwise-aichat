# Meta Integrations

## Scope

Private messaging using official Meta APIs:

- WhatsApp Cloud API
- eligible WhatsApp Business App Coexistence
- Instagram professional-account messaging
- Facebook Page Messenger

Public comments, broadcasts, and campaigns are deferred.

## Ownership

Realwise owns OAuth/embedded onboarding state, server-side code exchange, encrypted credentials, webhook verification, event normalization, outbound provider calls, and diagnostics. Chatwoot receives normalized conversations through API inboxes.

## Connection states

```text
NOT_STARTED
AUTHORIZING
CODE_RECEIVED
TOKEN_EXCHANGED
ASSETS_DISCOVERED
SUBSCRIBING_WEBHOOKS
SYNCING
CONNECTED
ACTION_REQUIRED
FAILED
REVOKED
DISCONNECTED
```

## Onboarding security

Use high-entropy single-use state bound to tenant, user, session, and expiry. Exchange codes immediately server-side. Never log codes. Validate redirect origin. Encrypt credentials and audit transitions.

## Webhooks

Preserve raw body where required, validate the official signature with constant-time comparison, support verification challenge, acknowledge quickly, process asynchronously, reject duplicates, tolerate ordering, and provide dead-letter and sanitized replay tools.

## WhatsApp

Do not ask customers to enter WABA IDs, phone-number IDs, tokens, secrets, or webhook URLs manually.

Implement Embedded Signup, asset discovery, current required subscriptions/registration, templates when required, status events, attachments, diagnostics, and eligible Coexistence.

### Coexistence

When eligible:
- import Business App human messages into Chatwoot;
- pause AI;
- never echo that message back to WhatsApp;
- document history-sync and device/reconnect behavior;
- verify current Meta behavior before coding.

Never market Coexistence as universal.

## Instagram

Require a currently supported professional account. Use the current recommended Instagram login flow. Handle DMs, supported attachments/reactions/statuses, revocation, permission loss, and App Review evidence. Public comments remain out of scope.

## Facebook Messenger

Use Facebook Login, list manageable Pages returned by official APIs, let the owner select a Page, obtain the appropriate Page authorization, subscribe the Page, handle Messenger messages, and detect permission/ownership changes.

## Research gate

Before coding each adapter, record official page, API version, permissions, access level, webhook fields, token lifecycle, test procedure, and review evidence in `docs/29-sources.md`.
