# CI/CD

## Pull request

- lockfile install
- format/lint
- typecheck
- unit/integration/security/accessibility tests
- build
- migration validation
- dependency audit
- secret scan
- container build and vulnerability scan
- SBOM

## Main

Run all checks and build versioned images. Production deployment requires an explicit flag and environment; credentials alone must not trigger deployment.

## Scheduled

Dependency report, security scan, backup restore test/reminder, license inventory, and provider-documentation review.

## Supply chain

Pin Actions and containers, review install scripts, enforce lockfile, scan secrets, generate SBOM, and never auto-merge dependencies.
