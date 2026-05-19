# Kybernesis Brain → Arcana Migration Requirements

> Status: Draft — 2026-05-19
> Audience: Arcana maintainers, Brain architect (Ian), KyberBot team
> Related: ADR 007 (shape thesis), docs/reviews/session-checkpoint-2026-05-19.md

---

## 1. Purpose

This document defines what it means for Kybernesis Brain to adopt Arcana as its portable brain kernel, replacing its Convex-bound cognition layer with Arcana's provider-abstracted contracts. It answers: what must be true in Arcana, what must Brain shed, what are the scope boundaries, and what decisions remain open.

---

## 2. Problem Statement

Kybernesis Brain is a full-featured agent memory system built on Convex, a real-time cloud database. It works but carries Convex-specific artifacts in its data model, query patterns, and enum vocabulary — making it hard to test in isolation, impossible to run offline, and coupled to a vendor that adds infrastructure cost and latency.

Arcana was designed to solve exactly this: a portable, provider-abstracted brain kernel with validated contracts, a demand-driven kernel, and swappable storage backends. KyberBot has already adopted Arcana (arcana-adoption branch, 22 commits, 724 tests), validating every write primitive in production. Brain's cognition layer maps to Arcana's contracts almost entirely — but the migration hasn't started.

The risk of not migrating: Brain continues to diverge from Arcana's evolving contracts, making future adoption progressively more expensive. The cognitive layer (facts, entities, edges, insights, memories) is the part that has the most vendor lock-in and the most to gain from portability.

---

## 3. Goals

1. **Define the Brain/harness boundary** — a clear, agreed line between what belongs in Arcana (cognition) and what stays in Brain's codebase (auth, connectors, workflows, multi-tenant).
2. **Enumerate Convex artifacts that must be shed** — concrete, actionable list so Brain can plan the migration without re-discovering coupling at implementation time.
3. **Identify what Arcana must build before Brain can migrate** — kernel methods and providers that Brain will need that KyberBot hasn't demanded yet.
4. **Choose a migration shape** — central (one shared Arcana instance) vs distributed (Brain owns its own Arcana instance). This is an open decision.
5. **Unblock KyberAgent Desktop adoption** — sqlite-vec provider is a dependency for Desktop and also removes ChromaDB from KyberBot. Not a Brain migration blocker but scheduled alongside.

---

## 4. Non-Goals

- This spec does not cover the migration of Brain's infrastructure layer (OAuth, MCP keys, connectors, multi-tenant, Motus workflows). Those stay in Brain's codebase permanently.
- This spec does not cover Arcana's read-side implementation (hybridSearch, factRetrieval, getEntityProfile). Those are demanded by the read pipeline work, not the migration per se — though Brain needs them eventually.
- This spec does not define the UI or client-facing surface of Brain. Brain's frontend/API layer is out of scope.
- This spec does not dictate the Postgres provider implementation details. That's a build artifact to be specced separately when the migration shape is chosen.

---

## 5. Users and Roles

| Role | Description | How they benefit |
|---|---|---|
| Brain architect (Ian) | Owns Kybernesis Brain codebase | Gets a clear migration plan; reduced vendor dependency |
| Arcana maintainer (David) | Owns arcana-* packages | Drives Brain to consume validated contracts; validates kernel design against a second real consumer |
| KyberBot team | KyberBot codebase consumer of Arcana | Indirect beneficiary — Brain adoption stress-tests contracts before KyberBot merges arcana-adoption |
| KyberAgent Desktop users | End users of Ian's desktop agent | Indirect beneficiary — sqlite-vec provider enables zero-Docker deployment |
| Future agent builders | Anyone building on Arcana contracts | Brain's migration proves the "portable brain" thesis at multi-tenant scale |

---

## 6. Product Scope

### In scope

- Brain's cognition layer: memories, chunks, entities, edges, facts, contradictions, insights, entity profiles, agent self (memory blocks)
- Mapping Brain's data model to Arcana contracts (entity by entity)
- Convex artifact shedding plan (5 specific artifacts)
- Arcana provider gap analysis (what Brain will need that doesn't exist yet)
- Migration shape decision framework (central vs distributed)
- sqlite-vec VectorStore provider specification (enables Desktop adoption + ChromaDB removal)

### Out of scope

- Brain's infrastructure layer: OAuth server, MCP API keys, connector syncs (Notion, Drive, Slack), multi-tenant org model, Motus workflow engine
- Arcana read-side implementation (hybridSearch, factRetrieval, getEntityProfile) — demand-driven; these will land when needed
- Any frontend, API gateway, or client-facing changes to Brain
- Arcana-provider-postgres build work — this is a downstream artifact; scoped once the migration shape is decided

---

## 7. Key Concepts / Entities

### Arcana's existing contract entities (all complete in arcana-contracts)

| Entity | Description | Brain equivalent |
|---|---|---|
| Memory | A stored memory item with lifecycle (active/archived/deleted), tier (hot/warm/archive), supersession chain | Brain's memory records |
| Chunk | Sub-piece of a Memory after text splitting; has layer (tier sync) and optional vectorId | Brain's chunk records |
| Entity | A named subject (person, company, concept) with mention count | Brain's entity records |
| Edge | A directed relationship between two NodeRefs with relation type and confidence | Brain's graph edges — currently 4-flat-ID model |
| Fact | An entity-attributed assertion, optionally decomposed into (attribute, value) triple; has expiresAt, surprisalScore, supersession | Brain's fact records |
| Contradiction | Two conflicting facts with status (pending, auto-resolved, user-resolved) | Brain's contradiction tracking |
| Insight | A derived deduction or induction about an entity, with supporting fact IDs | Brain's insight records |
| EntityProfile | Assembled profile for an entity: static facts (ProfileEntry[]), dynamic context, related entities | Brain's entity context |
| AgentSelf | Labeled memory blocks (persona, human, objectives) + history log | Brain's Letta-style agent memory |

### NodeRef — the graph node discriminator

Arcana uses `NodeRef = { type: 'memory' | 'entity' | 'chunk' | 'fact', id: string }` as the unified graph node pointer. This eliminates the need for shadow entity rows (a Convex artifact) by encoding the node type directly.

### ProfileEntry — structured fact attachment

`ProfileEntry = { value: string, factId?: string, confidence?: number, recordedAt?: string }`. EntityProfile.staticFacts is `ProfileEntry[]`, not `string[]`. This carries provenance (factId, confidence) per fact attachment.

---

## 8. Functional Requirements

### FR-1: Cognition layer adoption

Brain's cognition layer must write and read all cognitive data through Arcana's kernel interface (`arcana-core`), not directly to the database.

- Brain must call `ingest.storeMemory`, `command.recordFact`, `command.upsertEntity`, `command.linkNodes`, etc. through an `ArcanaKernel` instance.
- Brain must NOT write directly to its database for cognitive data. The Arcana provider is the only writer.
- Brain's harness may read non-cognitive data (auth, org membership, connector state) directly from its own store.

### FR-2: Convex artifact removal

Brain must shed all 5 Convex-specific artifacts from its cognition layer before or during migration:

1. **4-flat-ID edge model** → Replace with `{ from: NodeRef, to: NodeRef, relation, confidence, method, createdAt, sharedTags }` per `EdgeSchema`.
2. **Shadow entity rows** → Remove. NodeRef's type discriminator replaces the need for shadow rows in graph traversal.
3. **`_creationTime` timestamps** → Replace with explicit `createdAt: string (ISO 8601)` on every entity. Arcana kernel handles minting these at write time.
4. **Reactive query patterns** → Replace `useQuery` / `.collect()` with Arcana's `async provider method → plain data` pattern. Brain's real-time subscription layer stays in the harness.
5. **Loose enum vocabulary** → Replace Brain's inline `v.union(v.literal(...))` enums with Arcana's exported Zod enums from `@kybernesis/arcana-contracts`.

### FR-3: AgentSelf migration

Brain's Letta-style memory blocks must use Arcana's `AgentSelf` schema:
- `memoryBlocks: MemoryBlock[]` where `MemoryBlock = { label, content, updatedAt }`
- `history: MemoryBlockHistoryEntry[]` where each entry records `{ label, previousContent, changedAt, changedBy? }`
- Labels map directly: `persona`, `human`, `objectives` (or whatever Brain currently uses)

### FR-4: Temporal fact handling

Brain's temporal facts must use Arcana's existing `Fact.expiresAt?: string (ISO 8601)` field. Brain currently tracks an `isExpired` computed field — this becomes a runtime filter in Arcana's query layer (`expiresAt < now()` → exclude from default reads). Brain must NOT store `isExpired` as a persisted boolean; it is derived.

### FR-5: SurprisalScore storage

Brain's Jaccard novelty detection results must write to `Fact.surprisalScore?: number (0-1)` per FactSchema. The computation itself stays in Brain's harness (or eventually in Arcana's sleep pipeline step 11). Arcana stores the result; Brain may compute it externally until the sleep step is implemented.

### FR-6: Postgres provider

Brain requires a SQL-compatible Arcana provider that is not SQLite. A new `arcana-provider-postgres` (or `arcana-provider-pg`) package must be built implementing `StructuredStore` against Postgres. This is the blocking provider for Brain — unlike KyberBot (SQLite) and KyberAgent Desktop (sqlite-vec).

### FR-7: sqlite-vec VectorStore provider (parallel work, not a blocker)

`arcana-provider-sqlite-vec` must be built to implement `VectorStore` against sqlite-vec virtual tables. This:
- Unblocks KyberAgent Desktop adoption
- Allows KyberBot to drop its ChromaDB dependency
- Enables full E2E testing without Docker (`:memory:` SQLite + sqlite-vec)

This is not a Brain migration blocker but is scheduled alongside Brain migration planning.

---

## 9. Workflow Requirements

### Migration workflow (high-level phases)

**Phase 0 — Arcana readiness** (must complete before Brain migration starts)
- Publish all 5 @kybernesis/* packages to npm ← in progress
- KyberBot arcana-adoption branch merges to main ← in progress
- ADR 008 published (this analysis) ← in progress

**Phase 1 — Brain harness/cognition split**
- Identify and map every Brain database table to its Arcana entity
- Document which tables are cognition (migrate) vs harness (stay)
- Agree on the migration shape (central vs distributed)
- Build arcana-provider-postgres (or arcana-provider-pg)

**Phase 2 — Contract adoption**
- Add `@kybernesis/arcana-contracts` as a dependency
- Replace Brain's inline type definitions with Arcana's exported types
- Replace Brain's Convex enums with Arcana's Zod enums
- Replace 4-flat-ID edges with NodeRef edges; remove shadow entity rows

**Phase 3 — Kernel wiring**
- Add `@kybernesis/arcana-core` as a dependency
- Wire `initArcana({ structured: postgresProvider })` at Brain's startup
- Replace Brain's direct Convex mutations with Arcana kernel method calls
- Smoke test: write a memory, record a fact, link nodes, verify retrieval

**Phase 4 — Feature gap fill** (demand-driven as Brain's features need them)
- Timeline query (`queryFacts({ asOf })`)
- Fact expiry checking (sleep pipeline step or standalone method)
- SurprisalScore computation (sleep pipeline step 11 or Brain-side for now)
- hybridSearch, factRetrieval, getEntityProfile (when Brain's read pipeline demands them)

---

## 10. Data / Information Requirements

### Fact — temporal and novelty fields

Already in Arcana's `FactSchema`. Brain must map:

| Brain field | Arcana field | Notes |
|---|---|---|
| fact text | `fact: string` | Required, sentence form |
| entity id | `entity: string` | Required |
| attribute (optional) | `attribute?: string` | Triple decomposition |
| value (optional) | `value?: string` | Triple decomposition |
| confidence | `confidence: number (0-1)` | Required |
| expiresAt | `expiresAt?: string (ISO 8601)` | Optional temporal bound |
| isExpired (computed) | Derived: `expiresAt < now()` | NOT stored; computed at query time |
| dateGranularity | **Not in Arcana** — open question | See Open Questions §20 |
| surprisalScore | `surprisalScore?: number (0-1)` | Already in Arcana |
| sourceType | `sourceType: FactSourceType enum` | Must use Arcana's enum values |

### Edge — NodeRef model

Brain currently: `{ fromType, fromId, toType, toId, relation }` (4 flat columns).
Arcana requires: `{ from: NodeRef, to: NodeRef, relation, confidence, method, sharedTags, createdAt }`.

Migration requires a schema change on Brain's edge table, not a data loss event — `fromType` + `fromId` map directly to `from.type` + `from.id`.

### AgentSelf — memory blocks

Brain's current Letta-style storage shape is unknown in detail. It must be mapped to:
```
AgentSelf {
  memoryBlocks: [{ label, content, updatedAt }]
  history: [{ label, previousContent, changedAt, changedBy? }]
}
```

This is a single-row pattern — one AgentSelf record per Brain instance. Multi-tenant Brain has one AgentSelf per org/workspace, which maps to Arcana's `scopes` field or separate Arcana instances.

---

## 11. Business Rules

**BR-1: Cognition boundary is hard.** Brain's harness may not write cognitive data (memories, facts, entities, edges, insights) to the database directly once Arcana is adopted. All writes go through the Arcana kernel.

**BR-2: Schema validation at write time.** All data written through Arcana is Zod-validated at kernel write time. Brain's harness does not duplicate this validation.

**BR-3: `isExpired` is not stored.** Brain's current `isExpired` field must be removed as a persisted column. The query layer derives it from `expiresAt < now()`.

**BR-4: Shadow entity rows are removed.** Once NodeRef is adopted, shadow entity rows used for graph traversal of memory nodes are no longer valid and must be deleted.

**BR-5: SurprisalScore is optional.** Arcana stores it but does not require it. Brain's harness may compute and write it, or it may remain null until Arcana's sleep pipeline step 11 is implemented.

**BR-6: Enum values must match Arcana's.** Any Brain code that hard-codes string values for fact source type, memory tier, memory status, or contradiction status must adopt the exact enum values from `@kybernesis/arcana-contracts`. Mismatched strings will fail Zod validation at write time.

**BR-7: Multi-tenant isolation.** Brain's multi-tenant model is a harness concern. Arcana's `scopes` field provides lightweight namespacing but is not a full multi-tenant system. If Brain requires per-org data isolation at the provider level, the migration shape is distributed (one Arcana instance per org) not central.

---

## 12. Reporting / Dashboard Requirements

These are Arcana-level observability features Brain will benefit from once adopted:

- **Fact health**: count of facts by entity, flagged contradictions pending resolution, expired fact counts
- **Memory tier distribution**: hot / warm / archive counts; pinned counts
- **Entity graph size**: node count, edge count, disconnected entity count
- **Kernel method adoption trace**: which methods have been called (mirrors KyberBot's mochaccino kernel-methods tracking)
- **Sleep pipeline health**: last run timestamp, step counts, decay distribution (once pipeline is implemented)

These are not blocking requirements for migration — they are beneficial outputs once Arcana is the source of truth.

---

## 13. Non-Functional Requirements

**NFR-1: No Docker for local development.** The arcana-provider-sqlite-vec package must enable KyberBot and KyberAgent Desktop to run without Docker. Brain's Postgres provider does require a Postgres instance — this is acceptable for a cloud-hosted product.

**NFR-2: Test isolation.** All Arcana integration tests run against `:memory:` SQLite or equivalent in-memory fixtures. Brain's migration tests must follow the same pattern — no tests against a live Postgres instance in CI.

**NFR-3: Provider swap without kernel changes.** Switching from SQLite to Postgres or back must require only a provider configuration change. The kernel code must not contain database-specific logic.

**NFR-4: Incremental migration.** Brain should be able to adopt Arcana incrementally — starting with the write path, leaving reads on Convex temporarily — mirroring KyberBot's adoption pattern. Full cutover is a later phase.

**NFR-5: Backward-compatible contracts.** ADR-defined schemas are append-only during the migration window. No breaking schema changes to arcana-contracts while Brain is mid-migration.

---

## 14. Assumptions

- Ian has agreed Brain should migrate off Convex. This spec proceeds on that basis.
- Arcana's write contracts are stable (ADR 007 closed this). No major schema changes expected during migration.
- Brain's cognition layer and harness layer are separable without a full rewrite — i.e., Brain's code has enough modularity that the database calls can be redirected.
- Arcana-provider-postgres does not exist yet and must be built as part of Phase 1.
- The sqlite-vec provider work is parallel to Brain migration, not a prerequisite.
- `dateGranularity` on temporal facts (a Brain-specific field) is not in Arcana's current schema. Whether it belongs there or in Brain's harness is an open question.
- Brain's multi-tenant model will be handled at the harness level, not inside Arcana.

---

## 15. Constraints

- Arcana's published packages must be live on npm before Brain can take a version-pinned dependency. This is in progress.
- Brain's Postgres provider must implement the full `StructuredStore` interface — there is no partial implementation path. (Unlike demand-driven kernel methods, the provider must be complete to be useful.)
- KyberBot's arcana-adoption branch must merge before Brain adoption planning completes — KyberBot's integration is the reference implementation. Any gaps found there affect Brain's plan.
- The Arcana kernel is demand-driven — read methods (hybridSearch, factRetrieval, getEntityProfile) remain stubs until a consumer demands them. Brain cannot use these methods until they are implemented.

---

## 16. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Brain's cognition/harness boundary is harder to draw than expected — deep coupling found at implementation time | Medium | High | Run a mapping exercise against Brain's actual Convex schema before committing to Phase 2 |
| arcana-provider-postgres build is larger than expected — Postgres DDL, type mappers, and integration tests are a significant effort | Medium | Medium | Scope a minimal StructuredStore implementation first (no indexes, no FTS5 equivalent initially) |
| dateGranularity on temporal facts is a real domain requirement and belongs in Arcana contracts — adding it post-migration causes another renaming exercise | Low | Medium | Decide early (see Open Questions #1) and add to Fact schema before packages publish if needed |
| Multi-tenant isolation requires per-org Arcana instances — distributed shape is more complex than central | Medium | Medium | Run the isolation model decision (Open Questions #3) before Phase 1 |
| Brain migration competes with KyberBot delivery — Ian is working on KyberBot merge while Brain is his product | High | Low | Migration is not urgent; schedule after KyberBot merge |

---

## 17. Recommended MVP

The smallest Brain migration that delivers value and validates the approach:

**MVP: Write path only, single-tenant, SQLite**

1. Build `arcana-provider-postgres` (minimum viable: all StructuredStore methods, basic Postgres DDL, no FTS5)
2. Wire `initArcana({ structured: postgresProvider })` in Brain's startup
3. Adopt Arcana contracts for Memory, Fact, Entity, Edge (the four most-used cognition types)
4. Remove shadow entity rows and migrate edges to NodeRef model
5. Write a smoke test: store a memory, record a fact, link a node, query facts — all through Arcana kernel

**What this proves:** The contract mapping works. The Postgres provider works. Brain can write cognitive data through Arcana. KyberBot parity on the write path.

**What this defers:** Read-side (hybridSearch etc.), sleep pipeline, AgentSelf migration, Contradiction/Insight/EntityProfile migration, multi-tenant scoping, SurprisalScore computation.

---

## 18. Future Enhancements

Listed in dependency order:

1. **Read-side implementation** — hybridSearch, factRetrieval, getEntityProfile — land when Brain's read pipeline demands them
2. **Timeline query** — `queryFacts({ asOf })` for bitemporal fact retrieval
3. **Sleep pipeline** — all 13 steps; steps 1-9 from KyberBot reference, steps 10-13 (temporal expiry, surprisal, memory lifecycle, entity profile regen) new
4. **Multi-tenant scoping** — if Brain requires per-org isolation at the provider level
5. **arcana-provider-sqlite-vec** — parallel to Brain migration; unblocks KyberAgent Desktop and removes ChromaDB from KyberBot
6. **arcana-provider-postgres FTS5 equivalent** — full-text search on memories using Postgres tsvector; required for hybridSearch on Postgres
7. **Kybernesis Brain as Arcana reference implementation** — once fully migrated, Brain becomes the canonical multi-tenant Arcana consumer, complementing KyberBot (CLI) and KyberAgent Desktop

---

## 19. Open Questions

These must be resolved before Phase 1 can begin:

1. **dateGranularity on temporal facts** — Brain stores a granularity field alongside `expiresAt` (day, month, year — for display). Does this belong in Arcana's `FactSchema` as an optional field, or is it a Brain-harness display concern? If it belongs in Arcana, add it before publishing v0.1.0.

2. **Migration shape: central vs distributed** — Should Brain consume a shared Arcana kernel alongside KyberBot, or operate its own Arcana instance backed by Postgres? The central shape is simpler conceptually but assumes a shared provider. The distributed shape is what KyberBot already does — each consumer has its own storage. Which model does Brain's architecture require?

3. **Multi-tenant isolation level** — Does Brain need per-org data isolation at the database level (separate tables or separate Arcana instances per org), or is Arcana's `scopes` field sufficient for logical separation? This determines whether the migration shape is distributed-per-org or central-with-scopes.

4. **Brain's current cognition/harness boundary audit** — Has Ian identified which Convex tables/functions are pure cognition vs harness? Without this map, the migration scope is undefined.

5. **Postgres provider ownership** — Who builds arcana-provider-postgres: Arcana maintainer (David) or Brain team (Ian)? Given the migration is Brain-initiated, Ian's team building it (and contributing it to the arcana monorepo) is the natural split. But this needs explicit agreement.

---

## 20. Acceptance Criteria Summary

The Brain migration is complete when:

- [ ] Brain's cognition layer (memories, facts, entities, edges, insights, EntityProfile, AgentSelf) reads and writes through Arcana's kernel interface
- [ ] No direct database writes to cognitive tables outside of Arcana's provider
- [ ] All 5 Convex artifacts are removed from the cognition layer
- [ ] `arcana-provider-postgres` passes the same integration test suite pattern as `arcana-provider-libsql`
- [ ] Brain's test suite includes at minimum the same smoke test coverage as KyberBot's arcana-adoption integration tests
- [ ] `isExpired` is not stored as a persisted column; derived at query time from `expiresAt`
- [ ] Shadow entity rows are removed from Brain's database
- [ ] All enum values in Brain's cognition layer match `@kybernesis/arcana-contracts` exported enums exactly
- [ ] AgentSelf.memoryBlocks uses Arcana's `MemoryBlock` schema for persona, human, and objectives blocks

---

## Key Assumptions Made

- Ian has agreed Brain should migrate; this spec is not making the case, it is planning the execution
- Arcana's write-side contracts are frozen (post ADR 007); no further schema changes will require remapping
- Brain's codebase has sufficient modularity to redirect database writes without a full rewrite
- `dateGranularity` is currently a display/harness concern until decided otherwise
- The Postgres provider does not exist and must be built; it is not a trivial effort

## What Appears to Be Missing from the Brainstorm

- **Brain's actual schema audit** — the brainstorm describes what Brain has conceptually, but no actual table/column inventory was provided. Before Phase 1, this audit is essential.
- **Brain's read query patterns** — what does Brain's query layer currently look like? How does it compose results for the agent context window? This determines how far the read-side gap actually is.
- **Volume and scale expectations** — Brain is multi-tenant. What is the expected data volume per org? This affects the Postgres provider's indexing strategy.
- **Convex migration tooling** — how does data get out of Convex and into Postgres? A one-time migration script is implied but not addressed.
- **Version compatibility window** — during the migration, will both old and new code paths coexist? For how long? This affects whether Brain needs a feature flag or a hard cutover.

## The 5 Most Important Decisions the Product Owner Needs to Make

1. **Does `dateGranularity` belong in Arcana's FactSchema?** Decide before publishing v0.1.0 — it's cheaper to add now than to version-bump after.
2. **Central vs distributed migration shape** — one shared Arcana instance or one per consumer? This drives the entire provider architecture.
3. **Multi-tenant isolation model** — Arcana `scopes` field vs separate provider instances per org. This must be resolved before arcana-provider-postgres is designed.
4. **Who builds arcana-provider-postgres?** David (Arcana maintainer) or Ian (Brain architect)? Timelines and ownership depend on this answer.
5. **Migration phase gate: incremental or big-bang?** Does Brain adopt write-path first (like KyberBot did) or attempt a full cognition-layer cutover at once? Incremental is lower risk; big-bang is faster if Brain's test coverage is high.
