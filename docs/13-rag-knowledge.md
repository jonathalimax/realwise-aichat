# Knowledge and RAG

## Sources

Manual FAQ, plain text, structured business profile, services, pricing, hours, schedules, policies, PDFs, and safe website imports.

## Pipeline

```text
source
→ validate
→ extract safely
→ normalize
→ chunk
→ embed
→ pgvector
→ retrieve
→ optional rerank
→ grounded prompt
```

## Isolation

Every source, document, chunk, vector query, and import job is tenant scoped. Never derive tenant identity from model output. Add cross-tenant retrieval tests.

## Structured data first

Use structured tables/tools for prices, schedules, locations, business hours, and eligibility. Unstructured retrieval supplements structured truth.

## PDF security

Size/page limits, MIME and magic-byte validation, safe parser, timeout, decompression/memory limits, no embedded execution, malware-scanning extension, and full derived-content deletion.

## Website security

HTTPS by default; block private, loopback, link-local, metadata, and internal addresses; defend DNS rebinding; limit redirects/pages/size; validate type; forbid credentials; sanitize HTML.

## Prompt injection

Imported content is untrusted reference data. It cannot redefine system policy, authorize tools, request secrets, or change tenancy.

## Lifecycle

```text
PENDING
PROCESSING
READY
FAILED
DELETING
DELETED
```

Track checksum, version, source, status, error, chunk count, and last use. Reimport creates a new version and switches atomically.

Store source IDs and retrieval evidence with AI executions.
