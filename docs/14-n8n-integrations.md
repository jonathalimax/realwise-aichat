# n8n Integrations

n8n is an internal allowlisted orchestration engine. Customers never access its editor or submit arbitrary workflow IDs or URLs.

## Initial workflows

```text
create_calendar_event
notify_owner
append_lead_to_sheet
send_daily_summary
send_appointment_reminder
```

## Security

Every request includes tenant ID, correlation ID, timestamp, nonce, tool version, strict schema, and signed body. Receiver validates signature, age, nonce, tenant, and workflow binding.

## Reliability

Use timeout, bounded retry, idempotency, circuit breaker, safe response schema, failure queue, and support diagnostics.

## Data minimization

Send only required fields. Do not send full conversation history or provider credentials by default.

Workflow exports are versioned and reviewed as code.
