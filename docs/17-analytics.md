# Analytics

Use first-party append-only product events:

```text
tenant_id
user_id
anonymous_session_id
event_name
event_version
properties
occurred_at
source
```

Never store full message contents in analytics.

## Activation events

tenant_created, onboarding_step_completed, channel_connection_started, channel_connected, channel_connection_failed, knowledge_source_created, assistant_test_completed, first_ai_reply_sent, first_handoff_created, first_lead_created, first_appointment_requested, checkout_started, subscription_activated, subscription_canceled, and team_member_invited.

## Funnels

Visitor→account, account→tenant, tenant→channel, channel→first AI reply, trial→paid, failed connection→support resolution, AI conversation→lead, and lead→appointment request.

## Tenant metrics

Conversations, AI attempts, AI-resolved conversations, handoffs, human response time, leads, appointment requests, delivery failures, usage, and knowledge gaps.

An AI conversation is not “resolved” merely because AI sent one message. Define an outcome or closure rule.

Analytics is tenant scoped, data-minimized, and retention controlled.
