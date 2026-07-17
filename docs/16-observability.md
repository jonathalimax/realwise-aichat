# Observability

## Logging

Use structured JSON with timestamp, level, service, environment, correlation ID, tenant ID, connection/job/event IDs, operation, state, duration, and safe error code.

Exclude full messages, documents, tokens, authorization codes, passwords, MFA secrets, payment method data, and full provider payloads.

## Metrics

- API latency/errors
- webhook acceptance/processing/duplicates
- queue depth and age
- provider latency/errors
- delivery failures
- AI latency/handoff
- import failure
- Chatwoot provisioning
- Stripe event lag
- backup result
- tenant usage

## Health

```text
/api/health/live
/api/health/ready
/api/health/dependencies
```

Dependency detail is authorized.

## Tracing

Propagate correlation IDs across API, jobs, providers, Chatwoot, and n8n. Keep OpenTelemetry-compatible interfaces even if first deployment uses local logs/metrics.

## Retention

Use short operational retention and log rotation. Keep audit data according to policy. Do not inflate logs with every successful payload.

## Alerts

Queue age, signature failures, delivery spike, provider outage, DB/Redis failure, backup failure, disk pressure, repeated connection failure, Stripe backlog, and Chatwoot worker failure.
