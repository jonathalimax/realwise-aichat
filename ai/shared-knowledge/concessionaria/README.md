# Shared knowledge — concessionária

Scaffold directory for curated general-domain content for the `concessionaria` niche's shared
knowledge tier (vehicle law, financing basics, documentation — content that applies across every
tenant, not specific to any one dealership). Actual legal/domain content is supplied by the
business owner and uploaded via the admin-only shared-knowledge endpoints; files placed here are
a staging area, not auto-ingested.

## Format

One topic per markdown file. Start each file with a short header block (not strict YAML
front-matter, just a readable preamble) before the actual content:

```
title: O que é a garantia legal de um veículo
version: 2026-01
sourceCitation: Código de Defesa do Consumidor, art. 26

<actual markdown content starts here>
```

- `title` — short, matches how a visitor would ask the question.
- `version` — when this content was last reviewed/updated (free-form, e.g. a date or law revision tag).
- `sourceCitation` — the legal/official source backing the content (e.g. "CDC, art. 26"), shown to visitors alongside the answer when available.

Keep each file focused on a single concept (garantia, financiamento, documentação de
transferência, etc.) rather than one large omnibus document — this keeps retrieval chunks precise
and auditable.
