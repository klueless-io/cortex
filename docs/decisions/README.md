# Architecture Decisions

This directory holds Architecture Decision Records (ADRs) — short documents capturing non-obvious design or process decisions that future readers might question.

## Why these exist

ADRs live in the repo (not in memory or chat history) because:
- Code outlives sessions; sessions don't outlive code
- Future contributors (including future-you, Ian, Martin) need provenance for "why is this named/shaped this way?"
- Memory-system entries are personal; ADRs are shared

## Format

Each ADR is numbered sequentially with a kebab-case title:

```
001-method-renames-before-publish.md
002-...
```

Standard sections:
- **Status** (Accepted / Superseded / Reverted)
- **Date** + **Decider**
- **Context** — what triggered the decision
- **Decision** — what was decided
- **Consequences** — what follows
- **References** — commits, comms entries, related ADRs

## Current ADRs

- [001 — Method renames before publish](./001-method-renames-before-publish.md)
- [002 — `deleteEntity` added to StructuredStore interface](./002-deleteentity-contract-addition.md)
