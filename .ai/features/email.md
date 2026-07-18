# Email Delivery

Status: MOCK_VERIFIED

Implemented:

- `email_outbox` persists outgoing transactional email records.
- Invitation creation writes an `INVITATION` outbox record.
- Email verification requests write an `EMAIL_VERIFICATION` outbox record.
- Password reset requests write a `PASSWORD_RESET` outbox record.
- In production, auth endpoints do not return tokens in API responses; delivery must come from an email provider.
- In non-production, auth endpoints return tokens for manual/local testing.
- API smoke verifies all three outbox kinds.

Next:

- Add provider package for Resend/SES/Postmark.
- Add worker job to deliver queued outbox messages.
- Add retry/backoff and delivery status transitions.
