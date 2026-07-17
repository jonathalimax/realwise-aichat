# Backup and Disaster Recovery

## Scope

Realwise database, Chatwoot database, Chatwoot attachments, knowledge files, and encrypted configuration metadata.

## Destination

Support a mounted Hetzner Storage Box path with optional encryption, integrity checks, locking, disk protection, and failure notification.

## Baseline retention

```text
7 daily
4 weekly
6 monthly
```

## Restore test

Restore into isolation, run integrity checks, start the application against the restored copy, verify representative tenants and attachments, record duration/result, and remove the test environment safely.

## Scenarios

Accidental deletion, failed migration, database loss, attachment loss, Redis loss, VPS loss, provider outage, credential compromise, and disk exhaustion.

Redis cannot be the sole durable store for business events whose loss would affect customers.

Define RPO/RTO as internal targets, not guarantees.
