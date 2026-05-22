# System Health Audit — 2026-05-22

**Scope**: All 6 packages of the Arcana monorepo, all ADRs, all sprint plans, mochaccino dashboards, CHANGELOG, SPEC, PLAN, README. Conducted via 9 parallel layer agents.

**Excluded**: 16 findings already raised in the delivery-review against the v0.5.0 + v1.0.0 + v1.1.0 sprint deltas (see `docs/audits/delivery-review-2026-05-22.md` — separate report).

## Overall Verdict

**AMBER — solid core, dangerous seams, drifting docs.**

The code at the *unit* level is well-shaped: schemas are Zod-validated and strict, the access layer's CQRS split holds, the libsql provider parameterises every query, the testkit fakes are unusually complete, and the 10-step sleep pipeline is structurally consistent. But the system-level audit surfaces a different picture: **multi-step operations assume atomicity that isn't there, contracts promise behaviour the code doesn't deliver, and documentation has drifted hard across three sprints**. The kernel works as long as nothing concurrent, nothing partial, and nothing upgrading touches it — none of which holds in production.

Three findings are genuinely production-blocking. Twelve more should be fixed before KyberBot's adoption swap. The rest accumulate as v1.2 hardening debt.

---

## Cross-Layer Patterns

These are the systemic issues — each surfaced by multiple layer agents independently. Fix the pattern, not just the instance.

### Pattern A — Silent wrong-answer / no-signal degradation (10 instances)

The dominant bug class across the entire codebase. Operations fail or degrade silently with no warning log, no exception, no telemetry signal.

| Location | What happens silently | Layer agent |
|---|---|---|
| `maintain/index.ts:117` — orchestrator | `errors[]` from steps never read; failed steps marked complete | L4 BH-2 |
| `maintain/observe→profile→reasoning` | Pipeline runs all 10 steps green but produces zero insights due to entity name casing mismatch | L4 BH-4 |
| `libsql/getFactsForEntity` | Returns every historical version of every matching fact (no `is_latest` filter) | L6 BH-L6-005 |
| `libsql/getNeighbors` | Signature accepts `hops` param; impl always returns 1-hop | L6 EC-L6-011 |
| `libsql/deleteEntity` | Removes entity row only; edges/facts/insights left orphaned | L6 BH-L6-001 |
| `sqlite-vec/query` | `VectorQueryOpts.filter` silently ignored | L7 BH-009 |
| `retrieve/factRetrieval` | Empty query / oversized query / missing vector metadata → empty result, no warning | L2 EC-001/002/003 |
| `retrieve/assembledContext` | `tokenBudget` only used to derive topK; final context can exceed budget by 25× | L2 EC-005 |
| `ingest/extractFacts` | Storage failures + parse failures both logged at `debug` — indistinguishable | L3 BH-L3-003 |
| `ingest/extractFacts` | LLM returns N>3 facts; silently dropped to first 3 | L3 EC-L3-104 |

**Root cause**: there is no convention for "expected-empty vs broken-empty" anywhere. Every empty array could mean either.

**Recommended pattern**: introduce a `Result<T>` envelope with `{ value, partial?: { reason, droppedCount } }` for any operation that can return less than requested, and require `logger.warn` for every silent skip.

### Pattern B — Contract promises code doesn't keep (7 instances)

Documentation describes behaviour that the implementation doesn't actually deliver. Each is a future maintenance trap when someone trusts the contract.

| Contract claim | Reality |
|---|---|
| `tokenBudget` controls assembled context size | Only used to derive `topK` (L2 EC-005) |
| Source-layer priority `bridge > direct_facts > direct > entity_expansion > graph_expansion` | Final sort is purely by `score`; priority is just a label (L2 BH-001) |
| `keywordScore` collapses keyword+temporal+entity via sum | Uses `Math.max`; KB sums (L2 BH-003, likely real port bug) |
| `LLMCompleteOpts.maxTokens` is honored | claude-code provider ignores it (L7 BH-006) |
| `Scheduler.schedule` returns void; behaviour on duplicate name unspecified | Likely produces concurrent timers (L4 EC-5) |
| `_hops` parameter on `getNeighbors` | Underscore-prefixed = unused; ignores the value (L6 EC-L6-011) |
| `VectorQueryOpts.filter` | Silently ignored in sqlite-vec impl (L7 BH-009) |
| Schema versioning "documented" via JSDoc on contract | No runtime mechanism; old data fails Zod validation (L1 AR-002) |

**Recommended pattern**: every contract method whose impl doesn't fulfil the documented behaviour gets a `throw new Error('not implemented')` until it does. Documentation drift is a worse failure mode than `NotImplementedError` because callers depend on the lie.

### Pattern C — Multi-step writes assume atomicity that isn't there (5 instances)

| Where | Risk |
|---|---|
| `libsql.storeMemory + storeChunks` | Crash between leaves memory with no chunks | L6 BH-L6-003 |
| `libsql.storeChunks` re-chunk | Old chunks not deleted; getChunksForMemory returns mixed | L6 BH-L6-004 |
| `libsql.deleteEntity` | No cascade to edges/facts/insights — silent dangling refs | L6 BH-L6-001 |
| `maintain` checkpoint map | Scheduler tick + manual run race over shared closure state | L4 BH-1 |
| `libsql.connect()` ALTER TABLE | Two processes can both observe missing column, both attempt ALTER → one throws | L6 BH-L6-002 |

**Recommended pattern**: add a `transaction(fn)` primitive to the `StructuredStore` contract; require composite operations to use it; require concurrent-runner guards on long-lived stateful objects.

### Pattern D — Port-fidelity divergences not surfaced in docs (5 instances)

Beyond the delivery-review's 56% LOC reduction finding, the system audit surfaced *silent* divergences from KB that no ADR or CHANGELOG mentions.

| Divergence | Location |
|---|---|
| `FactSourceType` enum entirely Arcana-invented (KB has no `sourceType` column) | L9 F2 |
| `keywordScore` uses `Math.max` where KB sums | L2 BH-003 |
| Bridge layer cannot fire with single-entity queries (KB has full neighbor closure) | L2 BH-007 |
| `rebuild-user-profile` uses "most-mentioned entity" heuristic (KB has explicit user-profile module) | already in delivery-review |
| ADR 011 sets "100% parity" bar that has never actually been measured | L9 F3 |

**Recommended pattern**: amend ADR 011 to introduce a `§ Status of parity verification` table — one row per ported capability with `Target / Measured / Gap`. Convert aspirational claims into auditable accounting.

### Pattern E — Documentation has drifted hard across three sprints

| Doc | Drift |
|---|---|
| `README.md` | Says "Pre-alpha — v0.1.0 in progress"; actually v1.1.0 | L9 F7 |
| `SPEC.md` | Says "code written from scratch" — opposite of ADR 011; lists 5 packages (actually 6); 12-step sleep (actually 10); `bun install` (actually `pnpm publish -r`) | L9 F5 |
| `PLAN.md` | Frozen at 2026-05-18; never mentions v0.2 → v1.1, ADR 011, npm publish state | L9 F6 |
| `docs/decisions/README.md` | Lists ADRs 001-007 only; ADRs 008-013 exist as files but not indexed | L9 F12 |
| ADR 010 | Status still "Open — design decision deferred"; v1.1.0 explicitly resolved it | L9 F1 |
| Mochaccino views | Frozen at v0.4-v0.5; index.html still says v1.0.0; parity-gap.html still says v0.4.0 | L9 F8 |
| ADR 004 | No back-reference to ADR 013 even though ADR 013 narrowed it | L9 F4 |

A new contributor lands on README → SPEC → ADR README and gets a v0.1.0 mental model. None of it is true.

---

## Critical & High Findings (by layer)

### Production blockers — fix before any consumer adoption

| ID | Layer | Issue | Effort |
|---|---|---|---|
| L4 BH-4 | maintain | observe→profile→reasoning chain produces zero insights due to entity name casing | 1-2 hr (normalise at storage, or fuzzy-match in `getFactsForEntity`) |
| L6 BH-L6-005 | libsql | `getFactsForEntity` and `listMemories` don't filter `is_latest` — return every historical version | 30 min (add filter; default true) |
| L6 BH-L6-003 + 004 | libsql | `storeMemory + storeChunks` not atomic; re-chunk leaks stale chunks | 1 hr (wrap in `db.transaction`) |
| L6 BH-L6-001 | libsql | `deleteEntity` leaves orphaned edges/facts/insights | 30 min (cascade DELETE) |
| L6 EC-L6-011 | libsql | `getNeighbors` `hops` param silently ignored | 1-2 hr (recursive CTE) or throw if not 1 |
| L4 BH-1 | maintain | Scheduler tick + manual `runSleepPipeline` race over checkpoint state | 30 min (single-flight guard) |
| L4 BH-2 | maintain | Step with `errors[]` non-empty treated identically to clean success on resume | 30 min (partial-failure checkpoint state) |
| L9 F12 | docs | ADR README missing 6 of 13 ADRs (008-013) | 5 min |

**Subtotal: 8 high-leverage fixes, ~6 hours.**

### Strong recommendations — fix before v1.2

| ID | Layer | Issue |
|---|---|---|
| L1 AR-001 | contracts | StructuredStore is a god-interface; split into role-shaped sub-interfaces |
| L1 AR-002 | contracts | Schema versioning is doc-only; add `parseFact(unknown)` upgrade path |
| L2 BH-001 | retrieve | `MEMORY_PRIORITY` is a label not a tie-breaker — fix sort comparator |
| L2 BH-003 | retrieve | `keywordScore` uses `Math.max` where KB sums (likely port bug) |
| L2 EC-005 | retrieve | `tokenBudget` not enforced on `assembledContext` — silent contract lie |
| L2 BH-006 | retrieve | Layer 0 fan-out violates `topK` cap |
| L3 BH-L3-001 | ingest | djb2 contentHash is collision-prone for sleep-dedup |
| L3 BH-L3-002 | ingest | Prompt injection via raw content concatenation |
| L3 EC-L3-108 | ingest | `extractFacts` runs on soft-deleted memories |
| L4 AR-1+2 | maintain | 5 distinct step-result shapes; hardcoded if/else dispatch → registry |
| L4 EC-2 | maintain | `consolidationTitleThreshold: 1` wipes entire memory store (validate config) |
| L7 BH-009 | sqlite-vec | `VectorQueryOpts.filter` silently ignored |
| L7 BH-008 | sqlite-vec | L2 distance presented as similarity score; not bounded as callers assume |
| L7 EC-003/004 | sqlite-vec | Empty embedding / dim mismatch crashes with cryptic native error |
| L8 UT-L8-001 | tests | Compliance suite is stated in testkit README + ADR 009 but does not exist |
| L8 UT-L8-003 | tests | `maintain/index.test.ts` is the suite's mock-spy outlier — rewrite outcome-shaped |
| L8 UT-L8-006 | tests | No cross-package integration test (despite "swap providers safely" being the value prop) |
| L9 F7+F5 | docs | README + SPEC bring to v1.1.0 reality (30 min each) |
| L9 F3 | docs | ADR 011 add "Status of parity verification" section |

**Subtotal: 19 more findings, ~2-3 days of focused work.**

### Lower priority (v1.2 hygiene)

L1 CQ-006/007/008/009/010, L2 BH-005/007 + EC-003/004/006/007/008, L3 BH-005 + EC-101/102/103/105/106/107, L4 EC-1/3/4/6 + AR-3/4/5 + BH-5, L5 AR-3/7 + CQ-1/2/3/4/7, L6 BH-006/007/008/009/010 + EC-002/003/004/008/009/010/012, L7 BH-001/002/003/004/005/006/007/010 + EC-001/005/007/009, L8 UT-L8-002/004/005/007/008/010, L9 F1/F2/F4/F6/F8/F9/F10/F11/F13.

---

## Per-Layer Verdicts

| Layer | Verdict | Grade | Key strength | Key weakness |
|---|---|---|---|---|
| L1 Contracts | CONDITIONAL | B | Zod strict-mode is source of truth; NodeRef demonstrates discriminated-union discipline | StructuredStore is a god-interface; schema versioning is documentation-only |
| L2 Retrieve | CONDITIONAL | C+ | Four-channel topology is well-structured | Public contracts (`tokenBudget`, layer-priority, `keywordScore` summing) overstate what the code delivers |
| L3 Ingest | AMBER | B- | Honest about what's stubbed; KB fidelity high with line-level citations | Prompt injection surface; djb2 collision risk for sleep-dedup; LLM error path is "swallow all at debug" |
| L4 Maintain | SHIPPABLE WITH ISSUES | B- | Per-step logic is faithful to KB; structurally consistent across 10 files | Concurrency race + silent partial-failure + entity-name-casing chain break (highest silent-failure mode in the codebase) |
| L5 Access | PASS | B+ | CQRS split is real; updateMemory schema-reuse pattern is exemplary | `recordFact` and `ingest.extractFacts` build Facts independently — share before next schema change |
| L6 libsql | NOT PRODUCTION-READY | C | SQL is parametrised; FTS5 input well-defended; triggers transactional | Cascade gaps; `is_latest` inconsistency; `getNeighbors` lies about hops |
| L7 Vector + LLM | NEEDS WORK | C+ | Subprocess port is faithful to KB; sqlite-vec wire-up is clean | Silent filter drop; score-semantics confusion; cryptic crashes on dim mismatch |
| L8 Tests | PASS WITH GAPS | B- | 328 tests / zero skipped; createFakeStructuredStore is a serious complete fake | Compliance suite doesn't exist despite being the testkit's stated purpose |
| L9 Docs | DRIFTED | C+ | CHANGELOG chain verified end-to-end; ADRs themselves mostly internally honest | README + SPEC + mochaccino frozen 1-3 sprints behind reality; ADR index missing ADRs 008-013 |

---

## Praise

Worth naming what's actually well-done — the audit found these unprompted:

- **CQRS discipline in access/**: command returns void or freshly-minted ids; query is pure read. The id-returning commands are correct CQRS, not a leak.
- **Zod strict-mode everywhere**: every schema rejects unknown keys; type drift between schema and TS interfaces is structurally impossible.
- **`createFakeStructuredStore` (testkit)**: 286 lines, implements every method, enforces `connected` state, filters by scope/tier, has its own searchFulltext. Not the `vi.fn().mockReturnValue({})` sketch most TS SDKs ship.
- **`updateMemory` schema-reuse pattern** (`access/command/index.ts:154+`): derives `PUBLIC_UPDATE_SCHEMA` from `MemorySchema.omit().partial().strict()` — the right template for any future partial-update endpoint.
- **NodeRef discriminated union**: demonstrates the team understands the pattern; the bug here is not extending it to other places (FactSourceRef, supersededBy).
- **Adapter notes in every sleep step file**: every file has a header explaining KB provenance + the `root → providers` adapter pattern. Genuinely useful for future readers.
- **CHANGELOG end-to-end correctness**: every version 0.1.0 → 1.1.0 present, no skips; every ADR cited exists. The CHANGELOG is the most trustworthy doc in the repo.
- **Zero skipped tests**: no `it.skip` / `describe.skip` / `.todo` anywhere. Unusual and worth preserving.

---

## Recommended Action Plan

### Phase 1 — Production blockers (v1.1.1, ~6 hours)

Land before any KyberBot adoption swap. All are tight surgical fixes with existing tests as scaffolding.

1. **Entity name normalisation** in fact storage OR fuzzy match in `getFactsForEntity` + one end-to-end pipeline test asserting profile/insights produced after observe (L4 BH-4)
2. **`is_latest` filter default** on `getFactsForEntity` + `listMemories` (L6 BH-L6-005)
3. **Transaction wrapping** for `storeMemory + storeChunks` and `storeChunks` re-chunk path (L6 BH-L6-003/004)
4. **`deleteEntity` cascade** to edges + decide policy for facts/insights/profiles (L6 BH-L6-001)
5. **`getNeighbors` hops**: implement via recursive CTE OR throw if `hops !== 1` (L6 EC-L6-011)
6. **Scheduler/manual runtime guard** on `runSleepPipeline` (L4 BH-1)
7. **Partial-failure checkpoint state** — non-empty `errors[]` does NOT mark step complete (L4 BH-2)
8. **ADR README index** — add ADRs 008-013 (5 min — embarrassing if not done)

### Phase 2 — Pre-v1.2 (~2-3 days)

The 19 "strong recommendation" findings. Cluster them as:
- **Contracts hygiene PR** (L1 AR-001/002 + L4 AR-1/2 + L1 CQ items)
- **Retrieve correctness PR** (L2 BH-001/003 + EC-005 + BH-006)
- **Ingest hardening PR** (L3 BH-001/002 + EC-108)
- **Testkit compliance suite PR** (L8 UT-L8-001/003/006)
- **Docs reset PR** (L9 F1/F3/F5/F7 — README + SPEC + ADR 010 close + ADR 011 §parity-status)

### Phase 3 — v1.2 hygiene (~ongoing, low-priority)

Folded into normal sprint work. The lower-priority list above is the backlog.

---

## What the audit did NOT cover (out of scope, future work)

- **Security audit** (`/security-review`) — only spot-checked prompt-injection (L3 BH-002) and PATH-resolution (L7 BH-001). No threat model.
- **Performance benchmarks** — `linkMemories` O(N²) flagged in delivery-review; no profiling done at scale.
- **Cross-platform** — all findings are macOS-only verification; libsql/sqlite-vec on Linux/Windows untested.
- **CI/release tooling** — `.github/`, `package.json` scripts, publish workflow correctness not audited.
- **License + dependency audit** — `pnpm audit`, license compatibility across the dep tree not run.

## Synthesis

Three patterns matter more than any individual finding:

1. **The kernel works as long as nothing is concurrent, nothing is partial, nothing is upgrading.** Atomicity, partial-failure, and migration paths are the three areas where the system is brittle today. The "happy path" tests are excellent; the seams are unverified.

2. **Documentation drift is the cheapest fix and the highest first-read impact.** A new contributor or resuming KyberBot session reads README + SPEC + ADR README and gets a v0.1.0 pre-alpha mental model. Three hours of doc work moves the *perceived* state of the project forward by three sprints.

3. **The /goal autonomous-execution pattern shipped four sprints in two days, but the audit caught what it produced.** That's the right loop: fast forward motion plus periodic broad audits. Don't slow down the sprints — schedule the next system-audit after the next 2-3 sprints rather than per sprint.

Estimated effort to reach **PASS**: 6 hours for Phase 1 (production blockers); 2-3 days for Phase 2 (pre-v1.2). After Phase 1, this codebase is genuinely ready for KyberBot's adoption swap.
