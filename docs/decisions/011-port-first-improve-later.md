# ADR 011: Port First, Improve Later

**Date:** 2026-05-21
**Status:** Accepted
**Deciders:** David Cruwys
**Related:**
- ADR 009 (parity-gate methodology for consumer swaps)
- ADR 010 (sleep pipeline step reconciliation — to be re-resolved under this principle)
- docs/audits/sleep-pipeline-gap-analysis.md
- docs/plans/2026-05-21-hybrid-search-rebase.md (first application)

---

## Context

KyberBot was built first. It contains a working, in-production agent brain — memory, facts, entities, retrieval, sleep pipeline — all implemented in `kyberbot/packages/cli/src/brain/`. KyberBot uses this brain code every day.

Arcana was conceived as the portable extraction of that brain — a library KyberBot can consume so KyberBot's repo can focus on its harness concerns (auth, MCP, scheduling, multi-tenant routing) while reusable brain capability lives in `@kybernesis/arcana-*` packages.

The intended sequence:
1. Lift KyberBot's brain code into Arcana
2. Swap KyberBot to consume Arcana for those capabilities
3. Evolve Arcana's brain concepts forward; KyberBot inherits improvements; new consumers (Kyber in Cloud, KyberAgent Desktop, future agents) reuse the brain without re-inventing it

What actually happened across v0.1.x–v0.3.x: Arcana built its own version of each capability *informed by* KyberBot's behaviour but not *cloned from* it. The result is two parallel implementations that agree at the interface level but diverge in internal logic:

- `hybridSearch` ships 3 channels in Arcana (semantic + keyword + graph-BFS) vs KyberBot's 4 (semantic + keyword + temporal + entity-name-filter)
- The 13-step Arcana sleep design has no clean overlap with KyberBot's 10 working steps (ADR 010 was the attempt to bridge this; the gap analysis exposed the divergence)
- `getEntityProfile` synthesises across all entities in Arcana; KyberBot's profile is user-only
- `factRetrieval` does graph-expansion via `getNeighbors` in Arcana; KyberBot's fact-retrieval does not
- Each step inside the sleep pipeline (decay, observe, profile) has scope and behavioural differences that compound

A parity gate (ADR 009) measures these divergences but does not fix them. With current internal logic, the same query into both implementations produces different answers — and **you cannot have data parity if you are doing things differently inside the functions.**

The "Arcana invents better; KyberBot adapts" model defeats the original architectural purpose: a portable brain library that KyberBot consumes. If KyberBot has to re-validate every capability after every Arcana refactor, Arcana is not a library; it is a competing implementation.

---

## Decision

**For every brain capability, the trajectory is:**

1. **Port** — lift KyberBot's working logic into Arcana. Same algorithm, same step list, same SQL semantics (translated to Arcana's schema where the data models differ), same scoring constants. Aim for **100% data parity** verified by the parity harness (ADR 009).
2. **Swap** — KyberBot deletes its parallel implementation and wires through Arcana. Parity gate passes at 100%, not 80%.
3. **Improve** — *then* refactor Arcana's internal logic toward the cleaner shape, with KyberBot's tests as the regression battery. Land each improvement as a versioned v2 of the capability (or behind a feature flag), with the same parity discipline applied to any consumer that should adopt it.

**Speculative redesigns of Arcana's brain capabilities ship in v2 or behind a flag, never as the v1 implementation that KyberBot adopts.**

This applies to:
- `retrieve.hybridSearch` (v0.4.0 — first application of this principle; v2 graph-BFS retrieval deferred)
- `retrieve.factRetrieval` (future sprint; v2 graph-expansion deferred)
- `maintain.runSleepPipeline` (future sprint; v2 sleep pipeline gains Arcana's 4 added steps — collectCandidates, ingestionValidation, computeSurprisal, detectContradictions — *after* a 10-step KB-faithful v1 is proven)
- Any future capability sourced from KyberBot's brain

---

## What this means for past work

The contracts, schemas, provider abstractions, scopes, QueryResult envelope, FTS5 contract, parity harness, ADRs, mochaccino — none of that regresses. ADR 011 governs **internal logic of brain methods**, not contract surfaces.

A small number of v0.2.x–v0.3.x implementations need rebasing:
- `hybridSearch` (v0.4.0 — rebased in this sprint)
- `factRetrieval` (separate future sprint)
- `getEntityProfile` — its broader scope ("every entity" vs KyberBot's user-only) is *additive*, not divergent; queries for the user entity return the same data KyberBot would produce. **No regression on swap.** Stays as-is. The broader capability is "harmless improvement."
- Sleep pipeline implementation when it's time — ADR 010 will be re-resolved under ADR 011: port KyberBot's 10 steps as v1, queue Arcana's 4 additional steps for v2 sleep.

---

## What this means for future work

For every new brain capability proposed in Arcana:

- If a working KyberBot implementation exists, port it first.
- If no KyberBot implementation exists, treat the new Arcana capability as wave-2 from day one — feature-flag it, document it as Arcana-original, and expect any consumer adopting it to write its own parity baseline.
- Architectural improvements (cleaner channel topology, better algorithms, additional steps) are valuable but they live in v2, not v1. Discipline the impulse to invent at the v1 layer.

---

## Consequences

**Positive**

- KyberBot can swap to Arcana with confidence, not approximation. Parity tests target 100%, not 80%.
- Arcana's evolution is staged: v1 = match the empirical brain; v2 = improve the brain. Both forms can coexist; consumers choose when to adopt v2.
- The "harness vs brain" architectural separation becomes real — KyberBot stops re-implementing what Arcana now owns.
- New consumers (Kyber in Cloud, KyberAgent Desktop) inherit a *known-correct* brain, not one they have to re-validate.

**Negative**

- Some of Arcana's existing v1 implementations need rework. This sprint takes one (hybridSearch); future sprints take the rest.
- The "Arcana is the better version" narrative softens. Arcana is the *portable* version, the *known-correct-against-empirical-baseline* version. "Better" is a v2 property, earned after parity.
- Each v1 port is constrained by KyberBot's data-model decisions; some improvements are blocked by that constraint until KyberBot's schema can be migrated.

**Mitigations**

- Capability-by-capability migration; no big-bang rebase. Each port-and-prove cycle is one sprint.
- v2 designs are documented as they're displaced from v1 (this ADR is the start; future capability rebases will name what's deferred).
- The parity harness (ADR 009) tells us when a port is truly faithful (100% threshold under this discipline, not 80%).

---

## First application — v0.4.0 hybridSearch rebase

See `docs/plans/2026-05-21-hybrid-search-rebase.md`. Replaces the v0.2.0 3-channel + graph-BFS topology with KyberBot's 4-channel (semantic + keyword + temporal + entity-name-filter) topology. The graph-BFS retrieval becomes the deferred v2 hybridSearch. `HybridSearchResult.graphHops` input and `graphScore` output fields are kept for shape stability but emit as no-op/zero respectively, with deprecation notes.

This sprint also adds the `Memory.createdAt` schema field needed by the temporal channel — a contract addition that's intrinsic to KyberBot-faithful behaviour, not a separable concern.

---

## Status of parity verification

Per the system-health audit (docs/SYSTEM-HEALTH.md), the "100% parity" bar set above is the *target*. Actual measured parity against KyberBot fixtures is *pending* — no consumer has yet run the parity harness with real KB fixtures. This section converts the aspirational "100%" into auditable accounting and will be updated as fixtures land.

| Ported capability | Target | Measured | Gap |
|---|---|---|---|
| `hybridSearch` (v0.4.0) | 100% memory-id overlap on KB fixtures | pending KB fixtures | TBD |
| `factRetrieval` (v0.4.1 → v1.0.0) | 100% memory-id + fact-id overlap | pending KB fixtures | TBD |
| Sleep pipeline (v1.1.0) | All 10 KB steps run end-to-end against a real arcana instance | pending KB integration | TBD |

Known port-time divergences (not parity misses — deliberate or non-blocking):
- `FactSourceType` enum (Arcana-only — KB has no `sourceType` column; v1.0.0 kept for source-traceability)
- `rebuildUserProfile` uses "top entity by mentionCount" heuristic vs KB's explicit user-profile module (v2 sleep candidate)
- v1.1.0 sleep omits KB's AI-merge phases in `cleanEntityGraph` and its `sleep.db` telemetry tables (v2 sleep)

When KyberBot's `arcana-adoption` branch runs the parity harness with real fixtures, update this table with the measured numbers. Anything below 100% becomes a Phase-2 fix ticket against the next minor release.
