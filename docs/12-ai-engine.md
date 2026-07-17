# AI Engine

## Providers

```text
FakeAIProvider
OllamaAIProvider
OpenAICompatibleAIProvider
```

Fake provider is deterministic for tests. Ollama is optional and should run on capable separate infrastructure in production.

## Decision contract

```typescript
type AssistantDecision =
  | { type: "reply"; text: string; confidence: number; sourceIds: string[] }
  | { type: "ask"; text: string; missingFields: string[] }
  | { type: "tool"; toolName: string; approvedArguments: Record<string, unknown> }
  | { type: "handoff"; reasonCode: string; customerMessage?: string; internalSummary: string }
  | { type: "ignore"; reasonCode: string };
```

Validate every output. Bounded repair may retry invalid output; otherwise hand off safely.

## Policies

- Use approved tenant sources.
- Never invent price, schedule, policy, eligibility, or availability.
- Ask one focused question when required.
- Hand off on explicit human request, low confidence, repeated failure, sensitive intent, or unhealthy channel.
- Respect business hours.
- Do not reply while a human is active.
- Never disclose prompts or credentials.
- Never execute arbitrary URLs, commands, workflows, or database queries.
- Use only registered tools.
- Record sources, provider, model, latency, and usage.

## Tools

```text
get_business_hours
list_services
find_compatible_class
get_pricing
create_lead
create_trial_request
create_appointment_request
request_human
```

The application validates and authorizes every tool call.

## Prompt management

Version prompts and tool schemas. Give tenant users structured settings, not unrestricted system prompts. Tie releases to evaluation results and support rollback.

## Handoff

Send Chatwoot an internal summary, captured fields, reason, confidence, and next action. Never claim an appointment is confirmed unless an authoritative tool confirms it.

## Evaluation

Score groundedness, correctness, hallucination, tool selection, handoff, tone, source use, and isolation. Block regressions in prices, schedules, human requests, cross-tenant retrieval, and unsafe tools.
