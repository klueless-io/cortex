# Changelog

All notable changes to Arcana packages will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — `@kybernesisai/arcana-contracts` (ADR 007 §3.1)
- `MemoryStatusSchema` — `z.enum(['active', 'archived', 'deleted'])` lifecycle vocab for Memory rows
- `MemorySchema.status` — required field of type `MemoryStatusSchema`. Domain feature surfaced by the Brain-vs-Convex audit; both KyberBot and Brain track memory lifecycle, Arcana now does too. `ingest.storeMemory` defaults `status` to `'active'`. ([ADR 007](./docs/decisions/007-shape-thesis-portable-rules-not-records.md))

### Added — Memory-level supersession (ADR 007 §3.2)
- `MemorySchema.isLatest: boolean` (required) and `MemorySchema.supersededBy?: string` — mirrors the fact-level supersession pattern from ADR 006 at the memory level.
- `StructuredStore.markMemorySuperseded(oldMemoryId, newMemoryId)` — pure-link provider method: sets `isLatest=false` and `supersededBy=newMemoryId` on the old memory.
- `command.markMemorySuperseded(oldMemoryId, newMemoryId)` — kernel facade over the provider method; delegates and logs.
- `ingest.storeMemory` defaults `isLatest: true` (new memories are latest by definition).
- Implemented in the testkit fake (`createFakeStructuredStore`) with the same throw-on-unknown-id semantics as `markFactSuperseded`.

### Added — `@kybernesisai/arcana-core`
- `ingest.storeMemory(input)` — canonical row write with defaults + djb2 contentHash + UUID id ([commit 1f6a7c4](./))
- `command.upsertEntity(entity)` — persist an Entity via the structured store
- `command.deleteEntity(id)` — delete an Entity by id
- `command.linkNodes(from, to, relation, opts?)` — typed edge between any two NodeRefs (memory|entity), returns edge id
- `util/hash.djb2Hash` — 8-char hex hash for content deduplication

### Added — `@kybernesisai/arcana-testkit` (new package)
- `createFakeStructuredStore()` — in-memory fake with Map-backed CRUD
- `createFakeVectorStore()` — in-memory fake with deterministic dot-product search
- `createFakeEmbeddingProvider()` — byte-hash to 256-dim normalized vector (not for production)
- `createFakeLLMProvider()` — echo-with-prefix for prompt-passthrough assertions

### Added — `@kybernesisai/arcana-contracts`
- `StructuredStore.deleteEntity(id)` method (additive interface change)

### Changed — `@kybernesisai/arcana-core`
- **Renamed**: `command.linkMemories` → `command.linkNodes` ([ADR 001](./docs/decisions/001-method-renames-before-publish.md))
- Tests now use `@kybernesisai/arcana-testkit/fakes` instead of inline fakes

### Documentation
- `docs/adoption/kyberbot.md` — full adoption playbook (workspace setup, demand-driven rule, per-module recipe, cross-session protocol)
- `docs/adoption/kybernesis-brain.md` — parallel playbook for Ian
- `docs/decisions/001-method-renames-before-publish.md` — naming policy + rename window
- `~/dev/kybernesis/.comms/arcana-kyberbot.md` — cross-session protocol log (lives outside repo for cross-cutting access)

### Strategy
- v0.1.0 scaffold is feature-complete (contracts, config, core, testkit packages)
- T9 (testkit) revived in smaller scope; T10 (libsql provider) / T11 (CI) / T12 (publish) deferred until consumer demand justifies them
- Kernel methods implemented in demand-driven order — each KyberBot adoption module pulls the methods it needs

### Documentation corrections
- Adoption playbook (`docs/adoption/kyberbot.md`) row 4 was wrong: KyberBot's fact-store doesn't demand `command.recordFact`. KyberBot's facts are sentence-shaped (free text + entity list), not structured triples. They mirror via `ingest.storeMemory`. Triples are a future consumer (likely Kybernesis Brain). See ADR 003.
- Row 5 (`fact-extractor.ts`) clarified: same sentence mirror unless KyberBot's extractor evolves to produce triples (a separate, deliberate decision).

### Contract correction (supersedes the docs correction above)
- **`FactSchema` updated**: `fact` (sentence form) is now a required field; `attribute` and `value` (triple decomposition) are now optional. The original required-triple shape didn't fit either real consumer (audited code).
- ADR 003 marked **Superseded by ADR 004**.
- Playbook row 4 reverted to `command.recordFact` (KyberBot's facts ARE Facts under the corrected schema; they just lack the optional decomposition).
- `command.recordFact` and `query.queryFacts` move from stubbed to implemented:
  - `recordFact` validates via the corrected FactSchema, builds the Fact with UUID id + ISO timestamp + `isLatest=true`, persists via the StructuredStore, returns the new id
  - `queryFacts` reads via `structured.getFactsForEntity`, wraps in a fresh `QueryResult` envelope

### Contract addition — `updateMemory` (ADR 005)
- **Memory is not append-only.** Architectural audit triggered by David's challenge — both real consumers (KyberBot's INSERT OR REPLACE on source_path, Kybernesis Brain's `ctx.db.patch`) update memories in place. Arcana was missing the primitive.
- `StructuredStore.updateMemory(id, fields)` added to `arcana-contracts/src/providers.ts`.
- `command.updateMemory(id, fields)` implemented in `arcana-core/src/access/command/`. Partial update; `contentHash` recomputed when `content` changes; `scopes` replaces (does not deep-merge — matches Convex `patch` semantics).
- `command.pin(memoryId)` and `command.moveToTier(memoryId, tier)` move from stubbed to implemented (thin wrappers around `updateMemory`).
- Resolves DVR-UT-006 orphan-mirror flagged by KyberBot — fix path is option (b): KyberBot's wrapper checks `arcana_memory_id`, branches to `updateMemory` (existing) or `ingest.storeMemory` (new).

### Contract addition + deletion — supersede + contradiction (ADR 006)
- Driven by KyberBot module #11 (sleep/observe.ts) audit. Two new write paths surfaced (supersede + create-contradiction); one stub deleted as dead surface.
- **Added** `StructuredStore.markFactSuperseded(oldFactId, newFactId)` — pure-link op, sets old fact `isLatest=false, supersededBy=newFactId`.
- **Added** `command.markFactSuperseded(oldFactId, newFactId)` — kernel facade with logging.
- **Added** `command.storeContradiction(input)` — kernel facade over the existing provider-level `storeContradiction`. Mints id + createdAt; status defaults to `'pending'`; accepts optional `rationale`. Returns the new contradiction id.
- **Schema change**: `ContradictionSchema` gains optional `rationale?: string` (why detected — distinct from `resolution` which is how-resolved). Captures KyberBot's Haiku-extracted explanation rather than discarding it.
- **Deleted** `command.correctFact(oldFactId, newValue: string)` stub. Audit found no consumer wants combined create-and-supersede; the real pattern is `recordFact` + `markFactSuperseded`. Per ADR 005 process rule, dead surface area is removed.
- Testkit fake `StructuredStore` gains a `markFactSuperseded` implementation.

## v0.1.0 — TBD

Will be assigned when:
1. Ian reserves `kybernesisai` npm org
2. Initial KyberBot adoption sufficiently exercises the contracts to give them stability confidence
3. First publish via `npm publish` per package in dependency order
