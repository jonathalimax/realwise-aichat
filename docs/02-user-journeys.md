# User Journeys

## Self-service onboarding

```text
Landing
→ Create account
→ Verify email
→ Create tenant
→ Choose business type
→ Complete profile
→ Connect first channel
→ Add knowledge
→ Configure assistant
→ Test scenarios
→ Start trial or subscribe
→ Invite team
→ Activate
```

Every step is resumable and shows completion, errors, and next action.

## Assisted onboarding

A platform administrator creates the tenant and invites the owner. Staff may prepare knowledge and configuration, but the customer authorizes Meta assets and accepts terms. Activation requires reviewed prices, schedules, handoff, tests, and billing or pilot entitlement.

## WhatsApp

The owner starts Embedded Signup from Realwise. Backend validates state, exchanges authorization server-side, discovers assets, encrypts credentials, subscribes webhooks, creates Chatwoot API inbox, and runs a test. Coexistence, when eligible, mirrors Business App human replies and pauses AI.

## Instagram

The owner authorizes a supported professional account. Realwise stores credentials, subscribes events, creates an API inbox, and provides a DM test. Revocation changes the connection to `ACTION_REQUIRED`.

## Facebook Messenger

The owner logs in, selects a manageable Page returned by official APIs, and authorizes messaging. Realwise subscribes the Page, creates an inbox, and verifies a test conversation.

## Knowledge

Admins add structured business data first, then optional documents. The UI shows source status, version, extraction error, chunk count, and deletion. The playground shows sources used.

## Human handoff

1. Customer asks for a person or AI chooses handoff.
2. State becomes `HUMAN_REQUESTED`.
3. Chatwoot receives summary, reason, captured fields, and label.
4. Human response changes state to `HUMAN_ACTIVE`.
5. AI remains paused until explicit or post-resolution policy permits resumption.

## Billing

Backend creates Checkout. The success screen waits for verified webhook state. Customer Portal handles payment method and cancellation. Payment failure creates warning and grace period. Hard suspension stops outbound AI but preserves inbound and human handling.

## Support

The customer sees a safe support code. Support sees sanitized job, provider, and connection diagnostics. Sensitive message access requires explicit, time-limited authorization and audit.
