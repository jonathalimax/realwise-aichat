# Security Program

## Baseline

Target OWASP ASVS Level 2 and maintain a matrix mapping applicable requirements to code, tests, manual checks, status, and accepted risk.

## Threats

Cross-tenant access, IDOR, stolen integration credentials, OAuth state attack, authorization-code replay, forged webhooks, duplicate/reordered events, message loops, prompt injection, malicious files, SSRF, arbitrary workflow execution, session theft, secret leakage, support impersonation, dependency compromise, billing manipulation, and excessive retention.

## Controls

- deny-by-default authorization;
- tenant-scoped services;
- database constraints and selective RLS;
- Argon2id;
- secure sessions, CSRF, MFA, and step-up;
- AES-256-GCM credential encryption;
- webhook signatures and idempotency;
- rate limits;
- upload and SSRF controls;
- audit events;
- secret rotation;
- dependency, secret, and container scanning;
- no full message content in general logs.

## Headers

CSP, HSTS in production, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, frame restrictions, and sensitive-page cache controls. Avoid broad CSP wildcards.

## Support access

Exceptional content access is explicit, least-privileged, time-limited, reasoned, and audited.

## CI failure conditions

Committed secrets, critical vulnerability, failed tenant isolation, failed authorization, failed signatures, failed OAuth state, failed SSRF, failed encryption, or sensitive log detection.

## Incident response

Detect, declare, contain, rotate, preserve evidence, restore, communicate, and write a postmortem.
