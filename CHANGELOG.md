# Changelog

All notable changes to Arcana packages will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

## v0.1.0 — TBD

Will be assigned when:
1. Ian reserves `kybernesisai` npm org
2. Initial KyberBot adoption sufficiently exercises the contracts to give them stability confidence
3. First publish via `npm publish` per package in dependency order
