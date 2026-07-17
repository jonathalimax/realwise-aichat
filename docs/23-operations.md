# Operations

## Cadence

Daily: provider/queue health, failed jobs, disk, backup, security alerts.

Weekly: reconciliation, error trends, capacity, channel failures, support backlog.

Monthly: restore test, dependency review, retention, access review, admin sessions, secret age, costs.

## Severity

```text
SEV-1 broad outage, data exposure, or destructive corruption
SEV-2 major feature/provider failure affecting many tenants
SEV-3 limited tenant impact with workaround
SEV-4 minor defect
```

## Process

Detect, declare, assign lead, contain, communicate, restore, validate, close, postmortem, and track actions.

## Runbooks

Meta disconnect, Stripe backlog, Chatwoot worker failure, DB saturation, Redis failure, poison job, disk pressure, backup failure, secret rotation, tenant deletion, and provider rate limit.

Production changes require reviewed PR, passing gates, migration notes, rollback, and post-deploy owner.
