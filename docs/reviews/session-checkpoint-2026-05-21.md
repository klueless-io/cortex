# Session Checkpoint — 2026-05-21

This is a handover doc capturing where Arcana stands at the end of the 2026-05-21 session. It's structured so a fresh session (post-/compact) can pick up without re-deriving context.

## Where we are right now

**On npm (live):**
- `@kybernesis/arcana-contracts@0.4.1`
- `@kybernesis/arcana-core@0.4.1`
- `@kybernesis/arcana-testkit@0.4.1`
- `@kybernesis/arcana-provider-libsql@0.4.1`
- `@kybernesis/arcana-provider-sqlite-vec@0.4.1`

**On GitHub (`origin/main`):**
- HEAD: `e014959 chore(mochaccino): mark v0.4.1 publish complete`
- Tags pushed: `v0.1.1`, `v0.2.0`, `v0.2.1`, `v0.3.0`, `v0.3.1`, `v0.4.0`, `v0.4.1`
- Working tree clean

**Kernel matrix**: 22/28 implemented, 6 stubbed. 262 tests passing. Read parity 100%, write parity 100%, sleep pipeline 0%.

## What landed this session (2026-05-20 → 2026-05-21)

### v0.2.0 — FTS+hybrid sprint
- New contract: `StructuredStore.searchFulltext` + `FulltextMatch`/`FulltextSearchOpts`/`FulltextField` types
- libsql FTS5 virtual table + triggers
- Kernel `hybridSearch` implementation (initially 3-channel: semantic + keyword + graph-BFS)
- `queryFacts({ asOf })` + `getFactsForEntity({ asOf })` for bitemporal valid-time
- ADR 009 (parity gate methodology)
- ADR 010 (sleep pipeline step reconciliation — open at the time, later superseded by ADR 011)

### v0.2.1 — Query-zone easy facades + FTS5 input cap
- `query.getNeighbors`, `query.listContradictions`, `query.listInsights` — thin facades over existing provider methods
- 10 KB input cap on `buildFtsQuery` (defensive hardening from a Tier-2 audit)

### v0.3.0 — Parity harness
- `runParityHarness` + `ParityReport` exported from `@kybernesis/arcana-testkit/parity`
- Implements ADR 009's "future evolution" — the shared comparison engine consumers use during swaps

### v0.3.1 — Block-zone facades
- `query.readBlock`, `query.getBlockHistory` — thin facades over `getAgentSelf`
- Read parity 100% on the matrix

### v0.4.0 — hybridSearch rebase + ADR 011
- **ADR 011: Port first, improve later** — governing principle for all future Arcana brain-capability work. KyberBot is the empirical implementation; Arcana is its portable extraction; port faithfully before improving.
- `hybridSearch` rebased to KyberBot's 4-channel topology (semantic + keyword + temporal + entity-name-filter) — replaced the v0.2.0 invented topology.
- `matchType` vocab restored to KB-faithful `'semantic' | 'keyword' | 'both'`.
- `graphHops`/`graphScore` deprecated (kept for shape stability).
- Schema additions: `Memory.createdAt` (required, ISO 8601) + `StructuredStore.listEntities(filter?)`.

### v0.4.1 — factRetrieval rebase (2nd ADR 011 application)
- `factRetrieval` rebased to KyberBot's 4-layer flow: direct FTS → entity-name expansion (hop 0) → 1-hop graph expansion → bridge (memories linked to ≥ 2 seed entities).
- `why` field layer-tagged (`fact-retrieval/{direct|entity_expansion|graph_expansion|bridge}`).
- Source-layer priority: bridge > direct > entity_expansion > graph_expansion.
- No contract changes (patch bump).

### ADRs introduced this session
- **ADR 009** — parity-gate methodology for consumer swaps (top-N overlap test)
- **ADR 011** — port-first, improve-later principle (governs all future capability work)
- **ADR 012** — LLM provider architecture (two packages by transport: subprocess + multi-backend HTTP)
- **ADR 010** — sleep pipeline step gap (its prior "deferred" framing is implicitly superseded by ADR 011's port-first answer: adopt KB's 10 steps as v1, queue Arcana's 4 additional steps for v2 sleep)

### Plan documents
- `docs/plans/2026-05-20-fts-and-hybridsearch.md`
- `docs/plans/2026-05-20-tier1-tier2-facades-and-audits.md`
- `docs/plans/2026-05-20-parity-harness.md`
- `docs/plans/2026-05-21-hybrid-search-rebase.md`
- `docs/plans/2026-05-21-fact-retrieval-rebase.md`

### Audit / decision-support documents
- `docs/audits/sleep-pipeline-gap-analysis.md` — KB's 10-step pipeline vs Arcana's 13; foundational input to ADR 010 (now informed by ADR 011)

## Foundational finding still pending v2 work

**Finding 0 from v0.4.1 — Schema-depth divergence between KB's facts and Arcana's facts.** KyberBot has fact-level FTS5, fact→memory linkage, denormalised entities, a category field, and returns a rich bundle (`supporting_context` / `assembled_context` / `token_estimate` / `stats`). Arcana's `Fact` schema is lighter and `factRetrieval` returns memory-shaped `HybridSearchResult[]`.

**Implication**: v2 factRetrieval — schedule when a consumer (likely Kyber in Cloud) actually demands the rich-bundle return. Out of scope for any near-term sprint.

Full divergence list in `docs/plans/2026-05-21-fact-retrieval-rebase.md` Findings appendix.

## What's outstanding (not blocked on user)

### Queued — ready to execute as the next `/goal`
**`arcana-provider-llm-claude-code` package (v0.5.0)** — port from KyberBot's `claude.ts → completeSubprocess` path. Plan + goal.txt already written for this; see `docs/plans/2026-05-21-llm-claude-code-provider.md` and `docs/plans/goal.txt`. Self-contained new package. Implements `LLMProvider` from `arcana-contracts`. Unblocks future sleep pipeline implementation (sleep needs an LLM).

### Queued — separate future sprints
- **`arcana-provider-llm-http`** — multi-backend HTTP provider per ADR 012. Greenfield with retroactive port discipline when a consumer adopts. Not blocking.
- **Sleep pipeline implementation** — needs LLM provider first. Then port KB's 10 steps as v1 per ADR 011; queue Arcana's 4 additional steps (`collectCandidates`, `ingestionValidation`, `computeSurprisal`, `detectContradictions`) for v2 sleep.
- **v2 factRetrieval** — schema-depth work per Finding 0. Demand-driven.
- **`arcana-provider-postgres`** — Brain migration gate. Consumer-driven (Kyber in Cloud picks the driver when migration begins).

## What's outstanding (blocked on user)

Effectively nothing critical. The original "blocked on you" list shrunk over the session as the user clarified that several questions were actually consumer-driven rather than Arcana-architectural (Postgres driver, reranker pattern). The genuinely pending items are cosmetic decisions, none blocking.

## Pattern that worked this session

The `/goal` system was used for v0.3.0, v0.3.1, v0.4.0, v0.4.1. Each sprint:
1. Discussed the sprint shape with the user
2. Wrote `docs/plans/<date>-<topic>.md` and `docs/plans/goal.txt` together
3. User invoked `/goal $(cat docs/plans/goal.txt)`
4. Goal-runner executed autonomously, with Findings appendix populated per AC
5. User handled OTP publish
6. Dashboard refresh + comms confirmation entry committed

This pattern is now well-rehearsed. The next sprint (LLM Claude Code provider) uses the same pattern — plan + goal.txt are pre-written and ready to fire post-/compact.

## Next-action snippet

After /compact, immediately fire:

```
/goal $(cat docs/plans/goal.txt)
```

The goal.txt in the repo references `docs/plans/2026-05-21-llm-claude-code-provider.md` and targets v0.5.0 (new public API package, minor bump).

## Cross-session memory

The MEMORY.md file (auto-memory) captures durable preferences that should survive /compact:
- The "decision framing" preference: decide and explain, or show side-by-side previews; don't ask shape questions David can't hold in his head; default to wave-1 parity, document wave-2.
- The "comms orchestration" preference: David is the message bus, NOT the decider; every Arcana→KBOT entry needs a default action path + explicit bounce-back-via-QUESTION rule.
- Arcana ↔ KyberBot comms file: `~/dev/kybernesis/.comms/arcana-kyberbot.md`.

## Quick sanity-check commands for the next session

```bash
git log --oneline -5                              # confirm where main is
bun run test 2>&1 | tail -3                       # confirm 262 tests pass
npm view @kybernesis/arcana-core@0.4.1 version    # confirm v0.4.1 live
ls docs/plans/                                    # see all sprint plans
ls docs/decisions/                                # see all ADRs
tail -50 ~/dev/kybernesis/.comms/arcana-kyberbot.md  # see last comms entry
```
