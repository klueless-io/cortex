# Plan — v1.1.0 Sleep Pipeline Implementation

**Date**: 2026-05-22
**Mode**: code
**ADR governance**: ADR 011 (port-first) · ADR 010 (step reconciliation — now resolved: port KB's 10 steps as v1; Arcana-invented 5 deferred to v2 sleep)
**KB source of truth (READ FIRST)**:
- `/Users/davidcruwys/dev/kybernesis/kyberbot/packages/cli/src/brain/sleep/index.ts` — orchestrator
- `/Users/davidcruwys/dev/kybernesis/kyberbot/packages/cli/src/brain/sleep/config.ts` — SleepConfig + DEFAULT_CONFIG
- `/Users/davidcruwys/dev/kybernesis/kyberbot/packages/cli/src/brain/sleep/steps/` — 10 step files

## 1. Context

KB has 10 sleep steps (not 9 as ADR 010 originally counted): `decay → tag → consolidate → link → tier → summarize → observe → profile → reasoning → entityHygiene`. The Arcana scaffold at `packages/arcana-core/src/maintain/index.ts` lists 13 steps, with 5 that are Arcana-invented (not in KB): `collectCandidates`, `ingestionValidation`, `extractFacts` (in-sleep), `detectContradictions`, `computeSurprisal`.

Per ADR 011: port KB's 10 steps verbatim as v1. The 5 Arcana-invented steps go to v2 sleep (future sprint, demand-driven).

The Arcana sprint uses injected providers (`StructuredStore`, `VectorStore`, `EmbeddingProvider`, `LLMProvider`, `Scheduler`, `Logger`) rather than KB's direct DB access (`getTimelineDb`, `getSleepDb`). Each step must be adapted to use these interfaces. `updateMemory` and `deleteMemory` are already in both contract + libsql — no new contract methods needed for v1.

## 2. Step mapping (KB → Arcana)

| KB step | Arcana step name | Provider methods used | LLM? |
|---------|-----------------|----------------------|------|
| decay | decayMemories | `structured.getMemories()` + `updateMemory()` | No |
| tag | refreshTags | `structured.getMemories()` + `llm.complete()` + `updateMemory()` | Yes (Haiku) |
| consolidate | consolidateMemories | `structured.getMemories()` + `deleteMemory()` + `updateMemory()` | No |
| link | linkMemories | `embed.embed()` + `vector.search()` + `structured.createEdge()` | No |
| tier | tierMemories | `structured.getMemories()` + `updateMemory()` | No |
| summarize | summarizeMemories | `structured.getMemories()` + `llm.complete()` + `updateMemory()` | Yes (Haiku) |
| observe | observeConversations | `structured.getMemories()` + `llm.complete()` + `structured.storeMemory()` | Yes (Haiku) |
| profile | rebuildUserProfile | `structured.queryFacts()` + `llm.complete()` + `structured.storeEntityProfile()` | Yes (Haiku) |
| reasoning | runReasoning | `structured.getEntityProfile()` + `llm.complete()` + `structured.storeFact()` | Yes (Haiku) |
| entityHygiene | cleanEntityGraph | `structured.listEntities()` + `structured.getEntityProfile()` + `structured.deleteEntity()` | No |

Note: `createEdge` / `deleteEntity` / `storeEntityProfile` — check if these exist in StructuredStore contract; add if missing (patch bump within v1.1.0).

## 3. In scope

### Piece 1 — `SLEEP_STEPS` enum reconciliation
Replace the 13-step enum in `packages/arcana-core/src/maintain/index.ts` with KB's 10 steps (renamed to camelCase Arcana convention): `decayMemories | refreshTags | consolidateMemories | linkMemories | tierMemories | summarizeMemories | observeConversations | rebuildUserProfile | runReasoning | cleanEntityGraph`.

Document the 5 deferred steps in a code comment referencing ADR 011.

### Piece 2 — `SleepConfig` + `DEFAULT_CONFIG`
Port `SleepConfig` interface and `DEFAULT_CONFIG` verbatim from KB `config.ts` into `packages/arcana-core/src/maintain/config.ts`. Arcana-specific difference: `intervalMinutes` drives the `Scheduler` provider, not `setInterval` directly.

### Piece 3 — 10 step implementations
Create `packages/arcana-core/src/maintain/steps/` directory with one file per step. Each file exports `run<StepName>(deps: MaintainDeps, config: SleepConfig): Promise<StepResult>`. Port KB logic to use provider interfaces instead of direct DB access. Keep the same batch-size + per-run-max configuration hooks from KB's `config.ts`.

### Piece 4 — Orchestrator wiring
Implement `runSleepPipeline(input?)`, `startSleepSchedule(intervalMs)`, `stopSleepSchedule()` in `packages/arcana-core/src/maintain/index.ts`. `startSleepSchedule` delegates to `deps.scheduler.schedule(intervalMs, cb)`. In-memory checkpoint map tracks which step completed in the current run (for resume support).

### Piece 5 — Tests
- Orchestrator tests: `runSleepPipeline` calls all 10 steps in order, respects `steps` filter, returns `SleepRunResult`.
- Per-step smoke tests for the 4 mechanical steps (decay, consolidate, tier, entityHygiene) using in-memory StructuredStore fake.
- LLM steps (tag, summarize, observe, profile, reasoning) tested with `vi.mock('@kybernesis/arcana-contracts')` stub returning fixed responses.
- `startSleepSchedule` / `stopSleepSchedule` tested with a mock Scheduler.
- Target: ≥ 325 total tests (301 baseline + ~24 new).

## 4. Out of scope

- v2 sleep steps: `collectCandidates`, `ingestionValidation`, `extractFacts`-in-sleep, `detectContradictions`, `computeSurprisal`
- KB's `sleep.db` telemetry table — Arcana v1 uses in-memory step metrics only; structured telemetry is v2 sleep
- `arcana-provider-llm-http`, `arcana-provider-postgres`
- npm publish (David runs OTP)

## 5. Definition of done

`bun run build` exits 0. `bun run test` exits 0 with ≥ 325 tests. All 6 packages at v1.1.0. CHANGELOG v1.1.0 section. Mochaccino refreshed. Comms entry appended. Two commits + tag `v1.1.0` pushed to origin. npm publish NOT executed.

## 6. Acceptance criteria

| # | Criterion | Check |
|---|---|---|
| 1 | `SLEEP_STEPS` enum has exactly KB's 10 steps (camelCase renamed); 5 deferred steps noted in comment | grep enum |
| 2 | `SleepConfig` + `DEFAULT_CONFIG` ported from KB `config.ts` verbatim (field names + defaults) | diff against KB |
| 3 | `packages/arcana-core/src/maintain/steps/` has 10 files, one per step | ls |
| 4 | Each step file exports `run<Name>(deps, config): Promise<StepResult>` | TS compile |
| 5 | `runSleepPipeline` executes all 10 steps in KB order, respects `input.steps` filter | orchestrator test |
| 6 | `startSleepSchedule(intervalMs)` delegates to `deps.scheduler.schedule` | mock scheduler test |
| 7 | `stopSleepSchedule()` cancels the scheduled handle | mock scheduler test |
| 8 | `SleepRunResult` has `startedAt`, `finishedAt`, `stepsRun`, `candidatesProcessed` | shape test |
| 9 | Mechanical steps (decay, consolidate, tier, entityHygiene) have per-step smoke tests | run tests |
| 10 | LLM steps (tag, summarize, observe, profile, reasoning) have stub-LLM tests | run tests |
| 11 | All 6 packages at v1.1.0 | grep versions |
| 12 | `bun run build` exits 0 | exit code |
| 13 | `bun run test` exits 0 with ≥ 325 tests | exit code + count |
| 14 | CHANGELOG v1.1.0 section references ADR 010 resolution + ADR 011 + lists KB step count (10) + deferred 5 | grep |
| 15 | Mochaccino refreshed — kernel-methods (sleep pipeline 0%→100%), publish-pipeline (v1.1.0 lane not_started) | inspect |
| 16 | Comms entry dated 2026-05-22 appended — v1.1.0, sleep pipeline implemented (10 steps), default action: KB can now wire `startSleepAgent` call to consume Arcana's `maintain.startSleepSchedule` | tail comms |
| 17 | Two commits + tag `v1.1.0` pushed | git log + ls-remote |
| 18 | Findings appendix populated: KB→Arcana step name map, `root` → provider adapter pattern, checkpoint mechanism, Scheduler contract usage, any missing StructuredStore methods added | appendix |

## 7. Findings appendix

_Populated during the port. Each resolution cites KB file:line + Arcana code location._

### 1. KB step count was 10, not 9 (ADR 010 correction)

ADR 010 counted 9 KB steps (missed `reasoning`). KB `sleep/index.ts:28-30` imports `runReasoningStep` from `steps/reasoning.ts` and runs it between `profile` and `entity-hygiene`. Arcana `SLEEP_STEPS` now has 10 entries matching KB's actual count. The 13-entry v0.1 scaffold (which included the 5 Arcana-invented steps) is replaced.

### 2. `root: string` → injected providers adapter pattern

KB's steps call `getTimelineDb(root)` and `getSleepDb(root)` to get direct better-sqlite3 handles. Arcana's port replaces every DB read/write with the matching `StructuredStore` method:
- `timeline.prepare(SELECT ...).all()` → `deps.structured.listMemories(filter)`
- `timeline.prepare(UPDATE ...).run()` → `deps.structured.updateMemory(id, fields)`
- `timeline.prepare(DELETE ...).run()` → `deps.structured.deleteMemory(id)`
- `sleep.prepare(INSERT INTO memory_edges ...).run()` → `deps.structured.storeEdge(edge)`
- `getEntityGraphDb()` entity operations → `deps.structured.listEntities()` + `deleteEntity()`
- `getClaudeClient().complete(prompt, opts)` → `deps.llm.complete(prompt, opts)`

Arcana location: all 10 files in `packages/arcana-core/src/maintain/steps/`.

### 3. Step name mapping (KB snake_case → Arcana camelCase)

| KB step | Arcana step | Notes |
|---------|-------------|-------|
| decay | decayMemories | |
| tag | refreshTags | |
| consolidate | consolidateMemories | |
| link | linkMemories | |
| tier | tierMemories | |
| summarize | summarizeMemories | |
| observe | observeConversations | KB's observe.ts = fact extraction; same REALTIME_FACT_PROMPT as KB fact-extractor.ts:20-31 |
| profile | rebuildUserProfile | KB uses generateUserProfile/cacheProfile from user-profile.ts; Arcana uses storeEntityProfile |
| reasoning | runReasoning | |
| entity-hygiene | cleanEntityGraph | |

### 4. Checkpoint mechanism — in-memory Map instead of sleep.db

KB tracks run state in `sleep_runs` + `sleep_telemetry` tables in a separate `sleep.db` file (KB `sleep/db.ts`). Arcana v1 uses an in-memory `Map<SleepStep, boolean>` within the closure. Resume support (`input.resume = true`) skips already-completed steps within the same process lifetime. Cross-process resume (surviving restart) is v2 sleep — requires a telemetry store, likely added to `StructuredStore`.

Arcana location: `packages/arcana-core/src/maintain/index.ts` — `checkpoints` Map in `createMaintain`.

### 5. Scheduler contract usage

KB's `startSleepAgent(root, config)` manages a `setInterval` + `setTimeout` directly (KB `sleep/index.ts:150-180`). Arcana delegates to `deps.scheduler.schedule('arcana:sleep-pipeline', intervalMs, cb)` and `deps.scheduler.cancel('arcana:sleep-pipeline')`. When `createArcana()` is called without a scheduler, the stub scheduler throws `NotImplementedError` on invocation — same fail-fast behaviour as the rest of the stub ring.

Arcana location: `packages/arcana-core/src/maintain/index.ts:startSleepSchedule/stopSleepSchedule`.

### 6. Non-greedy regex bug in observeConversations — caught during test

KB's `observe.ts` extracts JSON with `/\[[\s\S]*?\]/` (non-greedy). When the LLM response contains nested arrays (e.g. `"entities": ["Alice"]`), the non-greedy match fires on the inner `["Alice"]` instead of the outer fact array, causing every item to be a bare string and failing the `entities.length === 0` guard. Fixed to greedy (`/\[[\s\S]*\]/`) in Arcana's port. KB hasn't hit this in production because its real LLM responses don't have nested arrays in the first position — the outer `[{...}]` always starts before any inner array.

Arcana location: `packages/arcana-core/src/maintain/steps/observe-conversations.ts:72`.
