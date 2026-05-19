# ADR 008: Brain Migration — Cognition/Harness Boundary and Convex Artifact Inventory

**Date:** 2026-05-19
**Status:** Accepted
**Deciders:** David Cruwys (Arcana), Ian Borders (Kybernesis Brain)
**Related:** ADR 007 (shape thesis), docs/requirements/brain-migration-requirements.md

---

## Context

Kybernesis Brain is a full agent memory system built on Convex. Ian has agreed it should migrate off Convex to SQL. ADR 007 established that Arcana's shape is correct (KyberBot convergence, Brain's differences are Convex artifacts). This ADR records the boundary between what belongs in Arcana (cognition) and what stays in Brain's codebase (harness), and inventories the specific Convex artifacts that must be shed.

---

## Decisions

### Decision 1: Brain/harness boundary

The line is: **does it reason, or does it route?**

| Layer | Belongs in | What it does |
|---|---|---|
| Cognition | Arcana | Memories, facts, entities, edges, insights, entity profiles, agent self (memory blocks) |
| Harness | Brain codebase | OAuth, MCP API keys, connector syncs, multi-tenant org model, Motus workflows |

This boundary is clean. The harness routes data in and authenticates callers. Arcana stores, relates, and maintains the cognitive data. They do not overlap.

### Decision 2: Schema gaps are in the kernel, not the contracts

Brain has features that appear absent from Arcana but are already in the contracts:

| Brain feature | Arcana contract field | Status |
|---|---|---|
| Temporal facts with expiry | `Fact.expiresAt?: string` | In contracts; not yet a kernel query filter |
| SurprisalScore (Jaccard novelty) | `Fact.surprisalScore?: number` | In contracts; not yet computed in sleep pipeline |
| Letta-style memory blocks | `AgentSelf.memoryBlocks: MemoryBlock[]` | In contracts; `updateBlock` kernel method is stubbed |

No schema additions are required for Brain to adopt Arcana. What's missing is kernel implementation — these fields exist but no kernel method uses them yet.

**One open question:** Brain stores a `dateGranularity` field alongside `expiresAt` (day/month/year for display). This may belong in `FactSchema` as an optional field. Decision deferred until before v0.1.0 final publish. See Open Questions in brain-migration-requirements.md.

### Decision 3: Five Convex artifacts must be shed from the cognition layer

1. **4-flat-ID edge model** → replace with `Edge.from: NodeRef, Edge.to: NodeRef`
2. **Shadow entity rows for memory graph nodes** → remove; NodeRef type discriminator eliminates the need
3. **`_creationTime` as timestamps** → replace with explicit `createdAt: string (ISO 8601)` on each entity
4. **Reactive query patterns** (`useQuery`, `.collect()`) → replace with Arcana's async provider methods
5. **Loose enum vocabulary** → replace with `@kybernesis/arcana-contracts` exported Zod enums

### Decision 4: `isExpired` is not a stored field

Brain's current `isExpired: boolean` is a computed state, not domain data. In Arcana, fact expiry is derived at query time: `expiresAt < now()`. Brain must not persist `isExpired` after migration.

### Decision 5: Migration shape is deferred

Two shapes are viable:
- **Central** — Brain's cognition layer uses a shared Arcana kernel with a Postgres provider
- **Distributed** — Brain gets its own Arcana instance (Postgres-backed), separate from KyberBot's SQLite instance

Both shapes require Brain to adopt Arcana's contracts. The difference is whether multi-tenant isolation is handled at the provider level or the harness level. This decision is deferred until Brain's isolation model is audited. See brain-migration-requirements.md §19 Q2–Q3.

---

## Consequences

- Brain migration planning can now begin using brain-migration-requirements.md as the working spec
- `arcana-provider-postgres` must be built (by Brain team or Arcana maintainer — TBD) before migration Phase 1 can complete
- `arcana-provider-sqlite-vec` is parallel work (unblocks KyberAgent Desktop + removes ChromaDB from KyberBot) and is not a Brain migration blocker
- The `dateGranularity` question must be resolved before packages are published at v0.1.0; if it belongs in Arcana contracts it should be added before that publish, not after
- Timeline query (`queryFacts({ asOf })`) is identified as entirely absent from Arcana's query surface — not even stubbed. This is a new kernel method gap, tracked in mochaccino 06-kernel-methods.json as status `missing`
