# AI Project Context

This folder is the canonical project map for AI agents and automation. Read it before changing code.

## Reading order

1. `project.md` — product, users, glossary, source-of-truth rules.
2. `architecture.md` — system architecture and cross-app contracts.
3. `conventions.md` — engineering rules agents must follow.
4. `commands.md` — local commands and validation commands.
5. `feature-map.md` — feature index and current status.
6. Relevant `features/*.md` files for the requested work.
7. Relevant `apps/*.md` files for the apps/packages being changed.

## Agent operating rules

- Treat `.ai/` as the highest-level documentation source for implementation state.
- Keep release states truthful: mocks are `MOCK_VERIFIED`, real credentials without evidence are not `PRODUCTION_VERIFIED`.
- Update matching `.ai/features/*.md` or `.ai/apps/*.md` when behavior changes.
- Pipeline handoff files live in `.pipeline/`.
