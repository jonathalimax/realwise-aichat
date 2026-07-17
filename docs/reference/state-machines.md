# State Machines

## Channel
`NOT_STARTED → AUTHORIZING → CODE_RECEIVED → TOKEN_EXCHANGED → ASSETS_DISCOVERED → SUBSCRIBING_WEBHOOKS → SYNCING → CONNECTED`

Failures: `ACTION_REQUIRED`, `FAILED`, `REVOKED`, `DISCONNECTED`.

## Conversation
`AI_ACTIVE`, `AI_WAITING`, `HUMAN_REQUESTED`, `HUMAN_ACTIVE`, `AI_PAUSED`, `AI_RESUME_PENDING`, `CLOSED`.

Human messages take precedence. Resume is explicit or post-resolution policy.

## Knowledge
`PENDING`, `PROCESSING`, `READY`, `FAILED`, `DELETING`, `DELETED`.

## Subscription access
`TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELED`.

## Job
`PENDING`, `RUNNING`, `RETRY_SCHEDULED`, `SUCCEEDED`, `FAILED`, `DEAD_LETTER`, `CANCELED`.

Transitions are validated and audited.
