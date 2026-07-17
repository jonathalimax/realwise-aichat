# Conventions

## Language

- Customer UI copy: Brazilian Portuguese.
- Code, schemas, logs and technical docs: English.

## Security

- Do not place provider tokens in browser state or localStorage.
- Encrypt external credentials with tenant-bound authenticated metadata.
- Never log full messages, documents, passwords, MFA secrets, authorization codes, tokens or payment method data.
- Webhooks must be idempotent and return quickly after durable acceptance.

## Product truthfulness

Use release states exactly:

- `PLANNED`
- `IMPLEMENTED_NOT_VERIFIED`
- `MOCK_VERIFIED`
- `SANDBOX_VERIFIED`
- `READY_FOR_EXTERNAL_ACTIVATION`
- `PRODUCTION_VERIFIED`

## UI

Prefer calm, status-first layouts. Avoid generic purple AI dashboards, fake stats and dense enterprise screens.
