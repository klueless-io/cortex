# Changelog

All notable changes to Arcana packages will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## v1.2.0 — 2026-05-22

System Health Phase 1 — eight production-blocker fixes from [docs/SYSTEM-HEALTH.md](./docs/SYSTEM-HEALTH.md) plus two doc closeouts. All 6 packages bumped to v1.2.0.

### Added — `@kybernesis/arcana-contracts`

- **`StructuredStore.transaction<T>(fn)`** — atomic multi-step write primitive. Every provider impl wraps `fn` in BEGIN/COMMIT (libsql) or no-op (testkit fake). Used by `ingest.storeMemory` to atomically commit memory + chunks (forward-compatible for future composite writes), and by libsql's `deleteEntity` cascade.
- **`getFactsForEntity(entity, attribute?, asOf?, latestOnly?)`** — fourth positional arg `latestOnly` (default `true`). Set to `false` for history queries.
- **`MemoryFilter.latestOnly`** — optional boolean (default `true`). Default behaviour now filters out superseded rows; set `false` for history queries.

### Changed — behaviour visible to consumers

- **Fact entities stored lowercased + trimmed** — `ingest.extractFacts`, `command.recordFact`, and `maintain.observeConversations` normalise `entities[]` before persistence. Existing libsql databases get a one-time idempotent migration (`schema_version=2` meta row) that lowercases `entities_json` on next `connect()`. `getFactsForEntity` lookup is now case-insensitive and case-tolerant on the query side.
- **Default `latestOnly=true`** on `listMemories` and `getFactsForEntity` — superseded rows are excluded by default; callers can opt back in with `latestOnly: false`.

### Fixed — System Health Phase 1 production blockers

1. **Entity name normalisation (audit BH-4)** — closes the observe→profile→reasoning silent failure where the pipeline ran green but produced zero insights because of case mismatch between extracted "caroline" and entity-table "Caroline".
2. **`is_latest` filter default** — `getFactsForEntity` and `listMemories` no longer leak historical/superseded rows by default (audit BH-L6-005).
3. **`transaction()` primitive** — `ingest.storeMemory` is now atomically wrapped; `deleteEntity` cascade uses the same primitive (audit BH-L6-003).
4. **`deleteEntity` cascades** to edges + insights + entity_profile, leaving facts intact (multi-entity schema preserved). Wrapped in `transaction()` (audit BH-L6-001).
5. **`getNeighbors` multi-hop** — libsql implements `WITH RECURSIVE` for hops 1-5; testkit fake implements BFS-from-seed. Throws outside the valid range. The contract has been lying about multi-hop since v0.1; now honest (audit EC-L6-011).
6. **`runSleepPipeline` single-flight guard** — concurrent calls share the same in-flight promise rather than racing closure state (audit BH-1).
7. **Partial-failure checkpoint state** — steps that complete with non-empty `errors[]` are checkpointed as `'partial'` and re-attempted on `runSleepPipeline({resume: true})`. `SleepRunResult` gains `partialSteps: SleepStep[]` so callers see partial failures without log-diving (audit BH-2).

### Doc closeouts

- **ADR 010** marked `Superseded by ADR 011 + v1.1.0` with a resolution epilogue explaining the port-first reframing (KB has 10 sleep steps, not 9 — Arcana's 4 extra step ideas deferred to v2 sleep).
- **ADR 011** gains §"Status of parity verification" — converts the aspirational "100% parity" into auditable accounting (target / measured / gap table per ported capability; known divergences explicitly named).
- **docs/decisions/README.md** index updated to list ADRs 008-013 (previously stopped at 007).

### Deferred to Phase 2 / Phase 3

The remaining 19 strong recommendations + lower-priority hygiene from the system health audit (see SYSTEM-HEALTH.md §"Phase 2" and §"Phase 3"). Notable items not addressed here: contracts surface split (god-interface), retrieve layer's `tokenBudget` enforcement on `assembledContext`, sqlite-vec score-semantics, SPEC/README/full-mochaccino refresh.

## v1.1.0 — 2026-05-22

Sleep pipeline implementation. All 6 packages bumped to v1.1.0. Resolves [ADR 010](./docs/decisions/010-sleep-pipeline-step-reconciliation.md) step-count gap under [ADR 011](./docs/decisions/011-port-first-improve-later.md) (port-first). KB source of truth: `kyberbot/packages/cli/src/brain/sleep/index.ts` + `config.ts` + `steps/`.

### Added — `@kybernesis/arcana-core`

- **`SLEEP_STEPS` enum** — updated to KB's 10 steps in execution order: `decayMemories → refreshTags → consolidateMemories → linkMemories → tierMemories → summarizeMemories → observeConversations → rebuildUserProfile → runReasoning → cleanEntityGraph`. Five Arcana-invented steps from the v0.1 scaffold (`collectCandidates`, `ingestionValidation`, `extractFacts`-in-sleep, `detectContradictions`, `computeSurprisal`) are deferred to v2 sleep per ADR 011.
- **`SleepConfig` + `DEFAULT_CONFIG`** — ported verbatim from KB `config.ts`. Controls batch sizes, LLM cost caps, tier thresholds, enable flags per step.
- **`runSleepPipeline(input?)`** — orchestrates all 10 steps in KB order. Respects `input.steps` filter. Continues past failing steps (each step is idempotent). Returns `SleepRunResult { startedAt, finishedAt, stepsRun, candidatesProcessed }`.
- **`startSleepSchedule(intervalMs)`** — delegates to `deps.scheduler.schedule('arcana:sleep-pipeline', ...)`.
- **`stopSleepSchedule()`** — delegates to `deps.scheduler.cancel('arcana:sleep-pipeline')`.
- **10 step files** in `packages/arcana-core/src/maintain/steps/`:
  - `decay-memories.ts` — age-based decay on `decayScore` + `priority` (access count counteracts decay; pinned memories exempt)
  - `refresh-tags.ts` — LLM refreshes stale/missing tags (Haiku; merges with existing)
  - `consolidate-memories.ts` — deduplicates memories by normalized title; keeps newest; applies decay multiplier to repetitive content
  - `link-memories.ts` — Jaccard tag similarity → `StructuredStore.storeEdge`; semantic relation type detection
  - `tier-memories.ts` — promotes/demotes memories between hot/warm/archive tiers
  - `summarize-memories.ts` — LLM regenerates tier-appropriate summaries for missing/short/raw-JSON summaries
  - `observe-conversations.ts` — LLM extracts facts from recent chat memories → `storeFact`; prompt ported verbatim from KB `fact-extractor.ts:20-31`
  - `rebuild-user-profile.ts` — aggregates facts for top entity via LLM → `storeEntityProfile`; freshness gate via `profileRefreshMinutes`
  - `run-reasoning.ts` — deduction + induction passes per entity (3+ mentions threshold); insights stored via `storeInsight`; prompts ported verbatim from KB `reasoning.ts`
  - `clean-entity-graph.ts` — removes artifact entities (Speaker 0, Unknown, etc.); prunes 1-mention entities with no facts

### Adapter pattern — `root: string` → injected providers

KB's sleep steps access the database directly via `getTimelineDb(root)` and `getSleepDb(root)`. Arcana's port replaces all direct DB access with `deps.structured` (StructuredStore), `deps.vector` (VectorStore), `deps.embed` (EmbeddingProvider), `deps.llm` (LLMProvider), `deps.scheduler` (Scheduler). No new contract methods were needed — `updateMemory` and `deleteMemory` were already in StructuredStore since v0.5.0.

### Deferred to v2 sleep

KB's `sleep.db` telemetry table (`sleep_runs`, `sleep_telemetry`, `maintenance_queue`). Arcana v1 uses in-memory step metrics only. AI-powered entity merge detection (KB's entity-hygiene step 2/3) — v1 implements automatic artifact deletion and low-mention pruning only.

## v1.0.0 — 2026-05-22

Schema deepening + Layer 0 fact-FTS + rich-bundle retrieval. All 6 packages bumped to v1.0.0 as one cohort. Per [ADR 013](./docs/decisions/013-fact-schema-deepening-before-sleep.md) (sequencing) and [ADR 011](./docs/decisions/011-port-first-improve-later.md) (port-first). KB sources of truth: `kyberbot/packages/cli/src/brain/fact-store.ts` + `fact-retrieval.ts` + `fact-extractor.ts`.

### Breaking — `@kybernesis/arcana-contracts`

1. **`FactSchema.entity` (string) → `FactSchema.entities` (string[])** — facts now carry a denormalised list of entity names (matches KB `fact-store.ts:38-46`). Minimum 1 entity required. Migration helper `widenLegacyFact(old)` exported to wrap a pre-v1.0.0 `LegacyFact` into the new shape.
2. **`FactSchema.category` is required** — `FactCategorySchema` enum has 8 members (`biographical | preference | event | relationship | temporal | opinion | plan | general`) ported verbatim from KB. Extractors default to `'general'` when unclassified.
3. **Source backlinks added** — `sourceMemoryId?`, `sourcePath?`, `sourceConversationId?` are now optional fields on every Fact. Enables Layer 0 → memory fan-out in factRetrieval.
4. **`StructuredStore.searchFactsFulltext(query, opts)`** — new contract method. libsql implements via FTS5 over `facts_fts(content, entities)`. Returns scored `FactsFulltextMatch[]` with `matchedFields: ('content'|'entities')[]`. Supports `category` + `latestOnly` (default `true`) filters.
5. **`StructuredStore.getFact(id)`** — new contract method. Returns `Fact | null`. Needed by factRetrieval's Layer 0 to resolve fact-FTS hits into the rich `ScoredFact` bundle.

### Breaking — `@kybernesis/arcana-core`

- **`factRetrieval` return shape**: was `QueryResult<HybridSearchResult[]>`, now `QueryResult<FactRetrievalResult>` where `FactRetrievalResult = { facts: ScoredFact[]; supportingMemories: HybridSearchResult[]; assembledContext: string; tokenEstimate: number; stats: { perLayerCounts, totalCandidates, deduplicatedCount } }`. Field names mirror KB `fact-retrieval.ts:31-59` (`FactSearchResult`). Token estimate = `Math.ceil(assembledContext.length / 4)` (KB convention from `fact-retrieval.ts:65-67`).
- **`factRetrieval` adds Layer 0** — direct fact-FTS via `searchFactsFulltext` runs before the existing memory layers. Layer-0 hits with `sourceMemoryId` fan out into `supportingMemories` with `why: 'fact-retrieval/direct_facts'`. Source-layer priority: `bridge > direct_facts > direct > entity_expansion > graph_expansion`.
- **`command.recordFact` input** — `entity: string` replaced with `entities: string[]`. `category?` (defaults to `'general'`), `sourceMemoryId?`, `sourcePath?`, `sourceConversationId?` now accepted.
- **`ingest.extractFacts(memoryId)` added** — port of KB `fact-extractor.ts:38-163` (`extractFactsRealtime`). Drives the LLMProvider with the verbatim `REALTIME_FACT_PROMPT`, parses the JSON array, validates each fact (rejects empty `entities[]`, caps to 3 per memory, defaults invalid `category` to `'general'`, caps confidence ≤ 0.9), and persists with `sourceMemoryId` backlink. Never throws — LLM/parse failures yield `[]`.

### Breaking — `@kybernesis/arcana-provider-libsql`

- `facts` table widened: new columns `entities_json`, `source_memory_id`, `source_path`, `source_conversation_id`, `category` (default `'general'`).
- New indices: `idx_facts_category`, `idx_facts_source_memory_id`, `idx_facts_source_conv`.
- New `facts_fts` FTS5 virtual table over `(content, entities)` with INSERT/UPDATE/DELETE triggers mirroring KB `fact-store.ts:213-225`. `storeFact` issues an explicit pre-DELETE on the FTS shadow row before INSERT OR REPLACE — libsql's FTS5 doesn't always clean shadow rows on conflict-replace.
- `getFactsForEntity` now matches against `entities_json` (case-insensitive LIKE with false-positive post-filter).

### Migration

Pre-v1.0.0 facts persisted in a v0.5.x libsql database have an `entity` column but no `entities_json`. There is no automatic in-place migration in this release — fact-bearing consumers must replay extraction or use `widenLegacyFact` in code. New databases start with the v1.0.0 schema directly.

## v0.5.0 — 2026-05-21

### Added — `@kybernesis/arcana-provider-llm-claude-code` (new package)

First concrete implementation of the `LLMProvider` contract. Subprocess-based wrapper around the Claude Code CLI (`claude -p`) — no API key required, uses the local Claude Code subscription.

Faithful port of KyberBot's `claude.ts → completeSubprocess` path (`kyberbot/packages/cli/src/claude.ts:184-410`). Per [ADR 011](./docs/decisions/011-port-first-improve-later.md) (port-first) and [ADR 012](./docs/decisions/012-llm-provider-architecture.md) (LLM provider architecture: subprocess vs HTTP transport split).

**Exports:**
- `createClaudeCodeLLMProvider(opts?)` — factory returning an `LLMProvider`-conforming object.
- `MODEL_IDS` — `{ haiku: 'claude-haiku-4-5', sonnet: 'claude-sonnet-4-6', opus: 'claude-opus-4-7' }` (mirrors KB `claude.ts:64-68`).
- `ClaudeCodeProviderOptions`, `ClaudeCodeModel` — types.

**Configuration:** `binary` (default `'claude'`), `defaultModel` (default `'haiku'`), `cwd` (for fleet-mode session-file attribution), `logger`.

**Sunset note:** the `claude -p` invocation pattern is scheduled for deprecation around mid-2026. When the replacement invocation lands, this provider's internals migrate; the `LLMProvider` contract stays stable — consumers do not change.

**Out of scope (deferred):**
- Streaming (`onChunk`) — defer to a future v2 evolution.
- Loop detection — defer with streaming.
- In-process Agent SDK mode — KyberBot disabled it for memory-leak reasons (`claude.ts:91-96`); not needed here.
- HTTP/API-key path — that is the separate `arcana-provider-llm-http` package (per ADR 012).

### Changed — all existing packages bumped 0.4.1 → 0.5.0

Version aligned across the workspace. No contract changes to existing packages — bump is for workspace coherence as the new 6th package joins at 0.5.0.

### Tests

262 → 275 (+13 new for the provider: happy path, default model, model mapping per shorthand × 3, cwd plumbing, stdin transport, `--dangerously-skip-permissions` always-on, system prompt, env scrubbing, non-zero exit, ENOENT, custom binary, logger).

## v0.4.1 — 2026-05-21

### Changed — `@kybernesis/arcana-core` — `retrieve.factRetrieval` rebased per ADR 011

Second application of [ADR 011](./docs/decisions/011-port-first-improve-later.md) (port-first). Rebased `factRetrieval` from the Arcana-invented "structured-only text-match + memory-expansion via `getNeighbors`" path to KyberBot's empirical 4-layer fact-retrieval flow.

Source: `kyberbot/packages/cli/src/brain/fact-retrieval.ts` (994 LOC).

**4-layer algorithm now in `factRetrieval`:**

1. **Direct layer** — FTS keyword match against memories via `searchFulltext` (KB scoring: `0.5 + matchRatio * 0.5`).
2. **Entity-expansion layer** — seed entities from query-name match via `listEntities`; their linked memories surface with score `1.0 × hop-0 penalty`.
3. **Graph-expansion layer** — 1-hop traversal from seed entities (KB's tuned precision setting at `fact-retrieval.ts:373`); each hop-1 entity's linked memories scored `0.7 × hop-1 penalty (0.7)`.
4. **Bridge layer** — memories linked to ≥ 2 distinct seed entities scored at `1.05 + (count-2) × 0.03` (above any single-entity match). Represents connective hubs across the query's entity span.

**Removed:** the Arcana-invented memory-expansion path via `structured.getNeighbors({ type: 'memory', ... })` in `factRetrieval`. (`structured.getNeighbors` itself remains in the contract — Layer 3 of the new impl uses it for entity-graph traversal, which is the KB-faithful use case.)

**`why` field is now layer-tagged**: `'fact-retrieval/direct' | '.../entity_expansion' | '.../graph_expansion' | '.../bridge'`. Source-layer priority determines the label when multiple layers fire for the same memory (bridge > direct > entity_expansion > graph_expansion).

**Contract surface unchanged**: `FactRetrievalInput` and `HybridSearchResult` shapes are identical to v0.4.0. Pure internal-logic change.

### Notes

- Schema-depth divergence between KyberBot's `facts` table (carries `category`, `source_path`, `source_conversation_id`, `entities_json`, fact-level FTS5) and Arcana's lighter `Fact` schema means a 1:1 schema port is infeasible at the patch level. This sprint ports the *algorithm shape*; rich-bundle return shape (KB's `supporting_context` / `assembled_context` / `token_estimate` / `stats`) is queued for a future v2 `factRetrieval`. Full divergence list in `docs/plans/2026-05-21-fact-retrieval-rebase.md` Findings appendix.
- Parity expectation for KyberBot's eventual `factRetrieval` swap is **100% on the memory-id set** (the swap-relevant contract surface). Rich-bundle parity requires the v2 work above.
- Tests: 258 → 262. Added per-layer coverage tests (direct, entity_expansion, graph_expansion, bridge) plus a `runParityHarness` smoke test.

## v0.4.0 — 2026-05-21

### Architecture — [ADR 011](./docs/decisions/011-port-first-improve-later.md)
- New governing principle: **port first, improve later.** Arcana's brain capabilities are sourced from KyberBot's working code. For every capability: port faithfully → swap consumer → verify 100% data parity → *then* improve in v2 (or behind a feature flag). Speculative redesigns no longer ship as the v1 implementation.

### Changed — `@kybernesis/arcana-contracts`
- `MemorySchema.createdAt: string` — new required field (ISO 8601). Set by `ingest.storeMemory` via `new Date().toISOString()` when the caller doesn't supply one. Needed by the temporal retrieval channel.
- `StructuredStore.listEntities(filter?)` — new contract method. Filter shape `{ nameContains?, scopes?, limit? }`. Mirrors `listMemories`. Required by the entity-name-filter retrieval channel.
- `EntityFilter` type — new interface for `listEntities`.
- `HybridSearchResult.matchType` vocabulary restored to KyberBot-faithful `'semantic' | 'keyword' | 'both'`. The v0.2.0 invented values `'graph'` and `'multi'` are removed. (Breaking for any consumer relying on the removed values; KyberBot was not relying on them since its swap is still pending.)

### Changed — `@kybernesis/arcana-core`
- `retrieve.hybridSearch` — rebased onto KyberBot's empirical 4-channel topology (per ADR 011). Replaces the v0.2.0 invented 3-channel (semantic + keyword + graph-BFS) topology with KyberBot's (semantic + keyword + temporal + entity-name-filter). RRF k=60, per-channel topK*3, reranker pattern, per-channel failure isolation all preserved. KyberBot's score-bucket convention is honoured: keyword + temporal + entity contributions collapse into `keywordScore`; `semanticScore` stays separate.

### Deprecated — `@kybernesis/arcana-core`
- `HybridSearchInput.graphHops` — accepted for shape stability, ignored at runtime. Graph-BFS retrieval returns as v2 hybridSearch after KyberBot's parity gate proves.
- `HybridSearchResult.graphScore` — always emitted as `0`. Same deprecation.

### Changed — `@kybernesis/arcana-provider-libsql`
- `memories` DDL adds `created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`.
- Idempotent migration on `connect()`: existing v0.3.x databases get an `ALTER TABLE memories ADD COLUMN created_at` if the column is missing. Default fills historic rows with the migration moment's timestamp.
- `listEntities(filter)` implemented over `entities` table with `LOWER(name) LIKE` substring match.

### Changed — `@kybernesis/arcana-testkit`
- Fake `createFakeStructuredStore` adds `listEntities` impl with the same filter semantics.

### Notes
- `retrieve.factRetrieval` still uses `getNeighbors` for graph expansion (Arcana-only; KyberBot's `fact-retrieval.ts` doesn't). This is a known port-first divergence flagged by ADR 011. `factRetrieval` rebase is a separate future sprint. The `matchType` collapses to `'keyword'` for both text-match and graph-expanded results in v0.4.0; the `why` field distinguishes them.
- `getEntityProfile`'s broader scope (every entity vs KyberBot's user-only) is additive — KyberBot would query the user entity and receive the same data. No regression on swap. Stays as-is per ADR 011 §"What this means for past work."
- The first application of ADR 011. Subsequent capability rebases (factRetrieval, sleep pipeline) will follow the same playbook.

## v0.3.1 — 2026-05-21

### Added — `@kybernesis/arcana-core` (block-zone facades)
- `query.readBlock(label)` — thin facade over `structured.getAgentSelf`; returns the content of the matching memory block or `null` if not found.
- `query.getBlockHistory(label)` — thin facade; returns the history entries filtered to the supplied label. Empty array when no history exists or agent-self has not been stored.

### Notes
- Closes the two block-zone stubs on the kernel matrix (20/28 → 22/28 implemented). Both methods are pure read facades — no contract changes, no provider changes.
- Currently no active consumer demand — implemented for completeness so that whenever Kyber in Cloud begins migration, the full `access.query` surface is available. Aligned with the "easier to reach parity now and delete unused later" position.

## v0.3.0 — 2026-05-20

### Added — `@kybernesis/arcana-testkit` (new subpath: `./parity`)
- `runParityHarness<TResult, TId>(input): Promise<ParityReport>` — generic top-N overlap harness for consumer swaps. Caller supplies a query corpus + two implementations (`baseline`, `candidate`) + an `extractIds` mapping; harness runs every query through both, computes per-query overlap, and aggregates a pass/fail report against a configurable threshold.
- Default `topN: 10`, `threshold: 0.8` — matches the methodology spec in [ADR 009](./docs/decisions/009-parity-gate-for-consumer-swaps.md).
- Per-query error capture: a failing baseline or candidate doesn't abort the run — the error is recorded with its `side` (`'baseline' | 'candidate'`) and that query contributes 0 to the mean overlap.
- Empty corpus returns `passes: false` (cannot prove parity with no evidence).
- 11 tests covering passing, failing, boundary, custom threshold/topN, error capture, empty corpus, and multi-query averaging.
- Subpath export: `import { runParityHarness } from '@kybernesis/arcana-testkit/parity'`.

### Notes
- Realises ADR 009 §"Future evolution" — the shared harness named there. Consumers (KyberBot, Brain) bring their own fixtures + implementations; the harness handles the comparison logic.
- Designed for the KyberBot hybrid-search swap blocked at top-10 overlap by the channel-topology divergence documented in `docs/plans/2026-05-20-tier1-tier2-facades-and-audits.md` Findings appendix.

## v0.2.1 — 2026-05-20

### Added — `@kybernesis/arcana-core` (query-zone facades)
- `query.getNeighbors(node, hops?)` — thin facade over `structured.getNeighbors`, wraps result in `QueryResult` envelope.
- `query.listContradictions(status?)` — thin facade over `structured.listContradictions`. Respects optional status filter.
- `query.listInsights(entityId?)` — thin facade over `structured.listInsights`. Respects optional entityId filter.

### Hardened — `@kybernesis/arcana-provider-libsql`
- `buildFtsQuery` now rejects inputs over 10 KB to bound memory + tokenizer cost. Surfaced by a Tier 2 read-only audit during this sprint (no exploit; defensive hardening).

### Notes
- Removes 3 stubs from `access.query` zone; matrix moves from 17 / 28 → 20 / 28 implemented.
- KyberBot can also call `arcana.providers.structured.*` directly for any still-stubbed query method — the provider methods are implemented even when the kernel facade isn't yet exposed.

## v0.2.0 — 2026-05-20

### Added — `@kybernesis/arcana-contracts`
- `StructuredStore.searchFulltext(query, opts?)` — new contract method. Provider-owned full-text index. Returns `FulltextMatch[]` with `memoryId`, normalised `score: 0..1`, and `matchedFields: FulltextField[]`.
- `FulltextSearchOpts` — `{ scopes?, tier?, topK?, fields? }`; filtering happens at the index layer.
- `FulltextMatch`, `FulltextField` types.
- `StructuredStore.getFactsForEntity` accepts optional `asOf: string` (ISO 8601) for bitemporal valid-time filtering. Backward compatible.

### Added — `@kybernesis/arcana-core`
- `retrieve.hybridSearch` — real implementation. Reciprocal Rank Fusion (k=60) over three channels: keyword (via `searchFulltext`), semantic (via `VectorStore`), graph (BFS via `getNeighbors`). Per-channel failures degrade gracefully. Optional reranker via existing `RerankerProvider` interface.
- `HybridSearchResult` shape evolved to wave-1 KyberBot-parity: `{ memory, score, semanticScore, keywordScore, graphScore, matchType, why? }`. `matchType: 'semantic' | 'keyword' | 'graph' | 'multi'`. Future wave-2 evolution to nested `channels` object deferred until consumers stabilise.
- `query.queryFacts` accepts optional `asOf` parameter — kernel facade for bitemporal valid-time queries.

### Added — `@kybernesis/arcana-provider-libsql`
- `memories_fts` FTS5 virtual table (`unicode61` tokenizer) + sync triggers on INSERT/UPDATE/DELETE of `memories` rows.
- `searchFulltext` implementation backed by FTS5 MATCH + bm25() ranking. Scope + tier filtering pushed into the SQL layer.

### Documentation
- [ADR 009](./docs/decisions/009-parity-gate-for-consumer-swaps.md) — Parity-gate methodology for consumer swaps. No consumer migrates from a working parallel impl to the kernel without a top-N overlap test (default ≥ 80%).
- [ADR 010](./docs/decisions/010-sleep-pipeline-step-reconciliation.md) — Sleep pipeline step reconciliation. Records the `consolidate`/`observe` gap between KyberBot's 9 steps and Arcana's 13. Decision deferred.
- `docs/plans/2026-05-20-fts-and-hybridsearch.md` — sprint plan capturing the wave-1 parity / wave-2 evolution principle.

### Added — `@kybernesis/arcana-contracts` (ADR 007 §3.1)
- `MemoryStatusSchema` — `z.enum(['active', 'archived', 'deleted'])` lifecycle vocab for Memory rows
- `MemorySchema.status` — required field of type `MemoryStatusSchema`. Domain feature surfaced by the Brain-vs-Convex audit; both KyberBot and Brain track memory lifecycle, Arcana now does too. `ingest.storeMemory` defaults `status` to `'active'`. ([ADR 007](./docs/decisions/007-shape-thesis-portable-rules-not-records.md))

### Added — Memory-level supersession (ADR 007 §3.2)
- `MemorySchema.isLatest: boolean` (required) and `MemorySchema.supersededBy?: string` — mirrors the fact-level supersession pattern from ADR 006 at the memory level.
- `StructuredStore.markMemorySuperseded(oldMemoryId, newMemoryId)` — pure-link provider method: sets `isLatest=false` and `supersededBy=newMemoryId` on the old memory.
- `command.markMemorySuperseded(oldMemoryId, newMemoryId)` — kernel facade over the provider method; delegates and logs.
- `ingest.storeMemory` defaults `isLatest: true` (new memories are latest by definition).
- Implemented in the testkit fake (`createFakeStructuredStore`) with the same throw-on-unknown-id semantics as `markFactSuperseded`.

### Added — ProfileEntry schema (ADR 007 §4)
- `ProfileEntrySchema` — `{ value: string, factId?: string, confidence?: number, recordedAt?: string }`. New provenance-aware entry type for profile arrays.
- `EntityProfileSchema.staticFacts` changed from `string[]` to `ProfileEntry[]`. Adds optional provenance (which fact established it), confidence score, and ISO timestamp per entry.
- Flat-string callers (KyberBot) migrate trivially: wrap each string in `{ value }`. Brain's structured arrays project naturally onto this shape.
- 5 new tests: value-only round-trip, fully-populated round-trip, empty value rejection, out-of-range confidence rejection, strict-mode unknown-key rejection. Plus regression test confirming raw strings in staticFacts now throw. ([ADR 007](./docs/decisions/007-shape-thesis-portable-rules-not-records.md) §4)

### Added — `@kybernesis/arcana-core`
- `ingest.storeMemory(input)` — canonical row write with defaults + djb2 contentHash + UUID id ([commit 1f6a7c4](./))
- `command.upsertEntity(entity)` — persist an Entity via the structured store
- `command.deleteEntity(id)` — delete an Entity by id
- `command.linkNodes(from, to, relation, opts?)` — typed edge between any two NodeRefs (memory|entity), returns edge id
- `util/hash.djb2Hash` — 8-char hex hash for content deduplication

### Added — `@kybernesis/arcana-testkit` (new package)
- `createFakeStructuredStore()` — in-memory fake with Map-backed CRUD
- `createFakeVectorStore()` — in-memory fake with deterministic dot-product search
- `createFakeEmbeddingProvider()` — byte-hash to 256-dim normalized vector (not for production)
- `createFakeLLMProvider()` — echo-with-prefix for prompt-passthrough assertions

### Added — `@kybernesis/arcana-contracts`
- `StructuredStore.deleteEntity(id)` method (additive interface change)

### Changed — `@kybernesis/arcana-core`
- **Renamed**: `command.linkMemories` → `command.linkNodes` ([ADR 001](./docs/decisions/001-method-renames-before-publish.md))
- Tests now use `@kybernesis/arcana-testkit/fakes` instead of inline fakes

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
