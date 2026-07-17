# Information Architecture

## Public routes

```text
/
/features
/whatsapp-ai
/instagram-ai
/facebook-messenger-ai
/academies
/pricing
/security
/privacy
/terms
/data-deletion
/contact
/sign-in
/start
```

## Tenant routes

```text
/dashboard
/onboarding
/channels
/channels/whatsapp
/channels/instagram
/channels/facebook
/assistant
/assistant/playground
/knowledge
/knowledge/faqs
/knowledge/imports
/leads
/appointments
/analytics
/team
/billing
/settings/business
/settings/security
/settings/retention
/support
```

## Platform routes

```text
/admin
/admin/tenants
/admin/plans
/admin/channels
/admin/webhooks
/admin/chatwoot
/admin/stripe
/admin/jobs
/admin/feature-flags
/admin/incidents
/admin/audit
```

Tenant agents cannot access billing, credentials, retention, exports, member administration, or destructive settings. Platform support sees sanitized operations. Platform owners control the most sensitive configuration.

Never place provider secrets or raw IDs in browser URLs.
