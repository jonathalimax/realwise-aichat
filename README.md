# Realwise AI Chat

Realwise AI Chat is a multi-tenant SaaS that connects WhatsApp Business, Instagram Direct Messages, and Facebook Messenger to an AI assistant and a shared human inbox.

## Product topology

```text
Meta APIs
  → Realwise Meta Gateway
  → Normalized Messaging Core
  → AI, Knowledge, Leads, Billing and Automation
  → Chatwoot Community Edition for human agents
```

- Customer application: `https://aichat.realwise.com.br`
- Shared inbox: `https://inbox.aichat.realwise.com.br`
- Deployment: Coolify
- Initial vertical: academies, martial-arts schools, gyms, dance schools, and appointment-based local businesses
- Customer UI: Brazilian Portuguese
- Code, schemas, and technical docs: English

Start with [`MASTER_PLAN.md`](MASTER_PLAN.md), then [`docs/README.md`](docs/README.md), and give [`.openharness/MASTER_PROMPT.md`](.openharness/MASTER_PROMPT.md) to OpenHarness.
