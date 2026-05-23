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
- [003 — Facts as memories vs facts as triples](./003-facts-as-memories-vs-facts-as-triples.md) (*superseded by 004*)
- [004 — Fact schema: sentence required, triple decomposition optional](./004-fact-schema-optional-triple-decomposition.md)
- [005 — Memory is not append-only; `updateMemory` is first-class](./005-memory-is-not-append-only.md)
- [006 — Contradiction.rationale addition + correctFact stub deletion](./006-contradiction-rationale-and-correctfact-deletion.md)
- [007 — Arcana's shape thesis: portable rules, not portable records](./007-shape-thesis-portable-rules-not-records.md)
- [008 — Brain migration boundary and Convex artifacts](./008-brain-migration-boundary-and-convex-artifacts.md)
- [009 — Parity gate for consumer swaps](./009-parity-gate-for-consumer-swaps.md)
- [010 — Sleep pipeline step reconciliation](./010-sleep-pipeline-step-reconciliation.md) (*superseded by ADR 011 + v1.1.0*)
- [011 — Port first, improve later](./011-port-first-improve-later.md)
- [012 — LLM provider architecture (subprocess + multi-backend HTTP)](./012-llm-provider-architecture.md)
- [013 — Fact schema deepening before sleep](./013-fact-schema-deepening-before-sleep.md)
- [014 — Library rename: Arcana → Cortex](./014-library-rename-arcana-to-cortex.md)
