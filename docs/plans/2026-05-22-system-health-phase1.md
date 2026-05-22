# Plan — v1.2.0 System Health Phase 1 (Production Blockers)

**Date**: 2026-05-22
**Mode**: code
**Driving audit**: /Users/davidcruwys/dev/kybernesis/arcana/docs/SYSTEM-HEALTH.md
**Version**: v1.2.0 (minor bump — contract grows additively; no external consumer affected since KyberBot hasn't swapped yet)

## 1. Scope

Eight production-blocker items from the system-health audit. Each ships with the architectural decision the user approved (see end of audit conversation).

| # | Item | Decision |
|---|------|----------|
| 1 | Entity name normalisation | Normalise at storage time (lowercase + trim) |
| 2 | `is_latest` filter on `getFactsForEntity` + `listMemories` | Add `latestOnly?: boolean = true` |
| 3 | `storeMemory + storeChunks` atomicity | Add `transaction<T>(fn)` primitive to StructuredStore contract |
| 4 | `deleteEntity` cascade | Cascade edges + insights + entity_profile; leave facts |
| 5 | `getNeighbors` multi-hop | Implement via `WITH RECURSIVE` in libsql; cap MAX_HOPS=5 |
| 6 | Single-flight guard on `runSleepPipeline` | Closure-level `running: Promise \| null` mutex |
| 7 | Partial-failure checkpoint state | Map<step, 'partial' \| 'complete'>; resume retries partial |
| 8 | ADR README index | Add ADRs 008-013 to docs/decisions/README.md |

Plus two doc closeouts surfaced by L9 audit:
- Close ADR 010 status to "Superseded by ADR 011 + v1.1.0"
- Add §"Status of parity verification" stub to ADR 011

## 2. Stack

Unchanged: 6 packages, bun + vitest + tsc, libsql + better-sqlite3 + sqlite-vec.

## 3. In Scope — concrete changes by item

### Item 1 — Entity name normalisation
- **arcana-core/src/ingest/index.ts** `extractFacts`: before each `storeFact`, lowercase + trim `fact.entities`.
- **arcana-core/src/access/command/index.ts** `recordFact`: same normalisation.
- **arcana-core/src/maintain/steps/observe-conversations.ts**: same normalisation.
- **arcana-provider-libsql/src/libsql-structured-store.ts** `connect()`: add a one-time idempotent migration step that lowercases existing `entities_json` values in the `facts` table. Mark the migration with a `meta` row (`schema_version=2`) so it doesn't run twice.
- **arcana-contracts/src/fact.ts**: add doc-comment to `FactSchema.entities` noting "stored lowercased; the canonical-casing display name lives on the Entity row."

### Item 2 — `is_latest` filter default
- **arcana-contracts/src/providers.ts**: add `latestOnly?: boolean` (default `true` documented) to `StructuredStore.getFactsForEntity` and `StructuredStore.listMemories` filter / `MemoryFilter`.
- **arcana-provider-libsql/src/libsql-structured-store.ts**: implement filter; default `latestOnly = true`.
- **arcana-testkit/src/fakes/structured-store.ts**: same.

### Item 3 — Transaction primitive
- **arcana-contracts/src/providers.ts**: add to StructuredStore:
  ```ts
  transaction<T>(fn: (tx: StructuredStore) => Promise<T>): Promise<T>;
  ```
- **arcana-provider-libsql/src/libsql-structured-store.ts**: wrap fn via `db.transaction(...)`. Pass `this` (the same StructuredStore instance) to `fn` — better-sqlite3's `Database.transaction` is synchronous, so the libsql impl is effectively "BEGIN; await fn(this); COMMIT/ROLLBACK". Document the no-savepoint / no-nested-transactions limitation.
- **arcana-testkit/src/fakes/structured-store.ts**: trivial impl — `return fn(this)`. Single-threaded; always "atomic". Document.
- **arcana-core/src/ingest/index.ts** `storeMemory`: wrap `storeMemory` + `storeChunks` in a transaction. If chunks generation throws, transaction rolls back.

### Item 4 — `deleteEntity` cascade
- **arcana-provider-libsql/src/libsql-structured-store.ts** `deleteEntity`:
  ```sql
  DELETE FROM edges WHERE (from_type='entity' AND from_id=?) OR (to_type='entity' AND to_id=?);
  DELETE FROM insights WHERE entity_id=?;
  DELETE FROM entity_profile WHERE entity_id=?;
  DELETE FROM entities WHERE id=?;
  ```
  Wrap in `transaction()` (re-use the new primitive from item 3).
- **arcana-testkit/src/fakes/structured-store.ts**: same logical cascade.

### Item 5 — `getNeighbors` multi-hop
- **arcana-provider-libsql/src/libsql-structured-store.ts** `getNeighbors`:
  - Accept `hops?: number` (default 1, max 5 — throw `Error('getNeighbors: hops must be 1-5')` outside that range).
  - Implement via `WITH RECURSIVE` (see audit DVR-EC-011 for the SQL shape).
  - Return DISTINCT `NodeRef[]` excluding the seed node itself.
- **arcana-testkit/src/fakes/structured-store.ts**: implement BFS-from-seed traversal up to `hops` levels.

### Item 6 — Single-flight guard
- **arcana-core/src/maintain/index.ts**:
  ```ts
  let running: Promise<SleepRunResult> | null = null;
  // in runSleepPipeline:
  if (running) return running;
  running = (async () => { /* existing body */ })();
  try { return await running; } finally { running = null; }
  ```
- Same guard protects the scheduler callback (which already calls `api.runSleepPipeline`).

### Item 7 — Partial-failure checkpoint state
- **arcana-core/src/maintain/index.ts**:
  - Change `checkpoints: Map<SleepStep, boolean>` → `Map<SleepStep, 'partial' | 'complete'>`.
  - In the step loop: if `result.errors && result.errors.length > 0` → `checkpoints.set(step, 'partial')`; else `'complete'`.
  - On `input.resume === true`, re-attempt any step where `checkpoints.get(step) !== 'complete'`.
  - Add `partialSteps: SleepStep[]` to `SleepRunResult` so callers see partial failures without log-diving.

### Item 8 — ADR README index
- **docs/decisions/README.md**: append entries for ADRs 008-013 mirroring the format of entries 001-007.

### Bonus doc closeouts
- **docs/decisions/010-sleep-pipeline-step-reconciliation.md**: change status to "Superseded by ADR 011 + v1.1.0". Add 2-line epilogue explaining the port-first resolution.
- **docs/decisions/011-port-first-improve-later.md**: add `§ Status of parity verification` section — table with one row per ported capability (`hybridSearch / factRetrieval / sleep pipeline`), columns `Target / Measured / Gap`. Initial values: target 100%, measured "pending KB fixtures", gap "TBD".

## 4. Out of Scope

- Phase 2 / Phase 3 audit items (19 strong recommendations + lower-priority hygiene)
- SPEC.md / README.md / mochaccino refresh (separate docs-only PR — Phase 2)
- Postgres provider, llm-http provider, ingestDocument impl
- npm publish (David runs OTP)
- KyberBot/Brain repo files

## 5. Definition of Done

`bun run build` exits 0. `bun run test` exits 0 with ≥ 350 tests (328 baseline + ~22 new). All 6 packages at v1.2.0. CHANGELOG v1.2.0 section explaining each of the 8 fixes + 2 doc closeouts. Mochaccino refreshed (kernel-methods test count, publish-pipeline v1.2.0 lane). Comms entry appended. Two commits + tag `v1.2.0` pushed to origin. npm publish NOT executed.

## 6. Acceptance Criteria

| # | Criterion | How to check |
|---|---|---|
| 1 | extractFacts/recordFact/observe normalise entities to lowercase+trim before storeFact | unit test: store "Caroline", read back as "caroline" |
| 2 | libsql connect() runs idempotent migration lowercasing existing entities_json | unit test: insert legacy uppercase row, connect again, verify lowercased + meta row |
| 3 | `getFactsForEntity('Caroline')` returns facts stored with `['caroline']` | round-trip test |
| 4 | Integration test: observe → rebuildUserProfile → runReasoning on a seeded chat memory produces ≥1 insight | new file: e2e test in arcana-core/src/maintain/ |
| 5 | StructuredStore.getFactsForEntity + listMemories accept `latestOnly?: boolean` (default true) | TS compile + unit test |
| 6 | Default behaviour filters out `is_latest=false` rows; `latestOnly:false` returns both | unit test in libsql + testkit fake |
| 7 | StructuredStore.transaction<T>(fn) added to contract | TS compile |
| 8 | libsql.transaction wraps fn in db.transaction; throw mid-fn rolls back | unit test: throw inside fn, verify no rows persisted |
| 9 | ingest.storeMemory wraps memory+chunks in transaction | unit test: simulate chunk-gen failure, verify memory not persisted |
| 10 | deleteEntity cascades to edges + insights + entity_profile (not facts) | unit test: create all 4 entity-related rows, delete entity, verify cascade |
| 11 | getNeighbors honors hops parameter (default 1, cap 5) | unit test: A→B→C→D, getNeighbors(A,2)=[B,C]; getNeighbors(A,6) throws |
| 12 | runSleepPipeline single-flight: concurrent calls share same promise | unit test: call twice in same tick, verify one underlying execution |
| 13 | Step returning errors[] non-empty marks checkpoint 'partial' | unit test: mock step with errors, assert checkpoint state |
| 14 | runSleepPipeline({resume:true}) re-attempts partial steps | unit test: first run partials, second run with resume retries |
| 15 | SleepRunResult includes `partialSteps: SleepStep[]` field | TS compile + unit test |
| 16 | docs/decisions/README.md lists ADRs 008-013 | grep |
| 17 | ADR 010 status changed to Superseded; epilogue present | grep |
| 18 | ADR 011 has new § "Status of parity verification" section | grep |
| 19 | All 6 packages at v1.2.0 | grep versions |
| 20 | `bun run build` exits 0 | exit code |
| 21 | `bun run test` exits 0 with ≥ 350 tests | exit code + count |
| 22 | CHANGELOG v1.2.0 section lists all 8 fixes + 2 doc closeouts, references SYSTEM-HEALTH.md | grep |
| 23 | Mochaccino refreshed — kernel-methods test count bumped, publish-pipeline v1.2.0 lane added (not_started) | inspect |
| 24 | ARCANA→KBOT entry dated 2026-05-22 appended to comms file — v1.2.0, contract changes summarised, parity expectation: no behaviour-visible regression on existing pipeline | tail comms |
| 25 | Two commits on main (feat: 8 fixes + 2 doc closeouts + chore: v1.2.0 bumps) + git tag v1.2.0 + push | git log + ls-remote |
| 26 | Findings appendix populated with concrete resolutions for each of the 8 items + any surprises encountered during port | appendix populated |

## 7. Findings appendix

_Populated during the work. Each resolution cites file:line + decision rationale where it surprised expectations._

### F1 — Entity normalisation: chose case-insensitive query side as defense-in-depth

Items 1 + 2 interact: the audit recommended "normalise at storage", and we did. But existing tests (and likely KBOT callers in their pre-swap branch) still call `getFactsForEntity('Alice')` with capitalised names against facts that were stored pre-v1.2.0 with capitalised entities. To avoid breaking those callers AND avoid forcing a hard cutover, the libsql `getFactsForEntity` post-filter was changed to case-insensitive comparison (`e.trim().toLowerCase() === needle`) in addition to producer-side normalisation. New facts are lowercase, pre-migration legacy facts may be mixed, queries handle both. See `packages/arcana-provider-libsql/src/libsql-structured-store.ts:551` and `packages/arcana-testkit/src/fakes/structured-store.ts:205`.

### F2 — Transaction primitive: `assertConnected` re-checks inside cascade methods

The libsql `transaction(fn)` calls `db.exec('BEGIN')` directly with non-null assertion on `db`. Inside `deleteEntity`, the cascade SQL also uses `db!` non-null assertions rather than calling `assertConnected(db)` inside each statement. Reason: the transaction block already ran `assertConnected(db)` at entry; the non-null assertions during the cascade reflect that contract. See `packages/arcana-provider-libsql/src/libsql-structured-store.ts:430-449`.

### F3 — Migration uses SQL `LOWER()` on entities_json

The audit listed "lowercase + trim" — but trim at the migration boundary would require row-by-row JSON parse + rewrite, slow on large databases. Going forward, producers normalise both lowercase + trim before storage; the one-time migration only `LOWER()`s existing rows (SQL-native, fast, no row parsing). Any whitespace already in stored entities will be cleaned the next time those facts are extracted via the producer path. See `packages/arcana-provider-libsql/src/libsql-structured-store.ts:285-294`.

### F4 — Resume re-tries 'partial' steps but not failed-by-exception steps

A step that throws a hard exception is NOT checkpointed at all (the orchestrator catches, logs, moves on). Resume picks it up because `checkpoints.get(step) !== 'complete'` (it's `undefined`). A step that completes with `errors[]` IS checkpointed as `'partial'` and also re-attempted on resume because `'partial' !== 'complete'`. Both classes re-run on resume; only `'complete'` is truly skipped. See `packages/arcana-core/src/maintain/index.ts:107-122`.

### F5 — Single-flight uses `===` identity check on shared promise

Two callers calling `runSleepPipeline()` simultaneously receive the *same* Promise<SleepRunResult>. Verified in test by `expect(a).toBe(b)`. The promise is cleared in `finally` after `await running` resolves — but a third caller arriving after the first two settle starts a new run normally. See `packages/arcana-core/src/maintain/index.ts:90-132`.

### F6 — getNeighbors recursive CTE returns DISTINCT rows but does NOT preserve hop-count

The recursive CTE accumulates `depth` for cycle prevention (`WHERE r.depth < ?`) but the final `SELECT DISTINCT type, id` discards depth. Callers asking for `hops=3` get the union of 1-hop, 2-hop, and 3-hop neighbours without knowing which is which. If a future caller needs depth information, the contract would need a new return shape (`{ ref: NodeRef; hops: number }[]`). Out of scope for v1.2.0. See `packages/arcana-provider-libsql/src/libsql-structured-store.ts:478-498`.

### F7 — Test fixture surprise: many Memory test fixtures omit `isLatest`

When changing `listMemories` default to `latestOnly=true`, several testkit + access-query tests broke because their `sample` Memory fixtures lack `isLatest: true` despite the Zod schema requiring it (test compilation didn't enforce strict types — vitest transforms separately from `tsc -b`). Two options: fix every fixture, or treat undefined as latest. Chose the latter — `m.isLatest !== false` rather than `m.isLatest` — more forgiving for test code and matches the contract intent (memories should default to current). See `packages/arcana-testkit/src/fakes/structured-store.ts:56-59`.

### F8 — Two existing markFactSuperseded tests needed `latestOnly: false`

`packages/arcana-provider-libsql/src/libsql-structured-store.test.ts:219` and `packages/arcana-core/src/access/command/index.test.ts:378` both stored a fact, marked it superseded, then queried via `getFactsForEntity` expecting to see the superseded row. With the new default, they couldn't. Updated both to pass `latestOnly: false` explicitly. This is the intended ergonomics — the new default protects production callers; explicit opt-in serves audit/history use cases.
