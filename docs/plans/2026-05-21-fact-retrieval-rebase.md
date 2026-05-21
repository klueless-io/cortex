# Plan — Rebase `factRetrieval` onto KyberBot's empirical impl (v0.4.1)

**Date**: 2026-05-21
**Mode**: code
**Driving session**: arcana-library
**Related**:
- [ADR 011](../decisions/011-port-first-improve-later.md) — port-first principle (this sprint is its second application after v0.4.0 hybridSearch rebase)
- docs/plans/2026-05-21-hybrid-search-rebase.md — the v0.4.0 sprint that established the playbook
- KyberBot reference: `/Users/davidcruwys/dev/kybernesis/kyberbot/packages/cli/src/brain/fact-retrieval.ts`

## 1. Stack

- Arcana monorepo at `/Users/davidcruwys/dev/kybernesis/arcana`
- All 5 packages at v0.4.0 (live on npm since 2026-05-21)
- KyberBot reference at `/Users/davidcruwys/dev/kybernesis/kyberbot/packages/cli/src/brain/fact-retrieval.ts` (the *empirical* implementation; source of truth for behaviour)
- Bun 1.3.10 / Vitest 4.1 / TypeScript 5.9 strict / ESLint 10
- This sprint bumps to v0.4.1 (patch — internal-logic change only; no contract additions; no public-API surface changes)

## 2. In Scope

### Capability rebase — `retrieve.factRetrieval`

Replace the internal logic of `arcana-core/src/retrieve/index.ts → factRetrieval` so it matches KyberBot's `fact-retrieval.ts` behaviour. The current Arcana impl is structured-only text-match with `getNeighbors` graph expansion — both Arcana inventions, neither sourced from KyberBot.

**Current Arcana impl (to replace):**
- `listMemories()` then JS-side word-hit scoring
- Optional depth-1 graph expansion via `structured.getNeighbors`
- Returns `HybridSearchResult[]` with `matchType: 'keyword'` (or formerly `'graph'` before ADR 011 vocab change)

**KyberBot's empirical impl (to port):**

Read `kyberbot/packages/cli/src/brain/fact-retrieval.ts` and port its 4-layer multi-stage retrieval faithfully:
1. **FTS layer** — keyword match against fact-store / memory content via `searchFulltext` provider (already in Arcana contract)
2. **Entity layer** — entity-name match (uses `listEntities` which v0.4.0 added) to find facts/memories linked to query-mentioned entities
3. **Graph layer** — walk fact graph for related facts (uses fact relationships)
4. **Bridge layer** — facts that connect two distinct entity clusters surfaced earlier

The behavioural details (scoring weights, fusion logic, layer interaction) are read from KyberBot during the port — not from earlier audits or assumptions. The goal-runner reads the file and ports faithfully.

**Contract surface:** unchanged. `factRetrieval(input: FactRetrievalInput)` returns `QueryResult<HybridSearchResult[]>` exactly as today. Internal logic changes; consumer-visible shape doesn't.

**What `factRetrieval` no longer uses internally:**
- `structured.getNeighbors` for memory-neighbor expansion (the Arcana-invented graph-expansion-via-getNeighbors path is removed)
- The hardcoded `why: 'text-match (structured-only, no FTS5)'` annotation pattern (replaced with KyberBot-faithful `why` values)

**What `factRetrieval` does still use:**
- `structured.searchFulltext` (v0.2.0 FTS5 contract — KB-equivalent)
- `structured.getFactsForEntity` (since v0.1.x)
- `structured.listEntities` (v0.4.0 — added precisely for this kind of routing)
- `structured.getNeighbors` *for entity-graph traversal* (different use case from the deprecated memory-neighbor expansion)

### Tests

Update `packages/arcana-core/src/retrieve/index.test.ts`:
- Remove tests that verify the Arcana-invented `getNeighbors` memory-expansion behaviour from `factRetrieval` (they no longer describe the impl)
- Add tests for each KyberBot-faithful layer: FTS layer, entity-layer routing, graph-layer relations, bridge cases
- Add a parity-harness smoke test using `runParityHarness` from `@kybernesis/arcana-testkit/parity` — same-impl baseline asserting `passes: true`. (Real parity verification against KyberBot's actual `fact-retrieval.ts` lives in KyberBot's repo per ADR 009.)
- Existing `factRetrieval` tests that cover envelope shape, depth respect, empty-query handling stay if they still describe the new impl; updated otherwise.

### Documentation

- CHANGELOG.md v0.4.1 entry: explains the rebase, references ADR 011 as governing principle, names the KyberBot file as source of truth, lists what was removed and what replaces it.
- Mochaccino refresh:
  - `06-kernel-methods.json` — update `factRetrieval` entry to reflect rebase; flip its `consumers.kyberbot.mode` from `parallel` to whatever fits post-rebase (still `parallel` until KyberBot's own swap happens, but the parity expectation now jumps to 100%)
  - test count bump in summary
  - `03-publish-pipeline.json` — add v0.4.1 lane (status `not_started` pending OTP)
- View regeneration: `kernel-methods.html` (factRetrieval row + tagline + test counter), `index.html` (test count, done strip), `publish-pipeline.html` (chips + lane)

### Comms entry

Append to `~/dev/kybernesis/.comms/arcana-kyberbot.md`. Mirrors the v0.4.0 comms pattern:
- v0.4.1 ships `factRetrieval` rebased onto KyberBot's logic — second application of ADR 011
- Parity expectation for KyberBot's eventual `factRetrieval` swap: 100% (not negotiable; same as hybridSearch)
- Default action for KyberBot: bump deps to `^0.4.1` when convenient
- Bounce-back via QUESTION rule covering: parity test failures (port bug; report), TS issues, any backward-compat surprises

### Ship sequence

- Two commits on `main`: `feat` (rebase + tests + docs + mochaccino + comms) then `chore` (version bump)
- `git tag v0.4.1`
- `git push origin main && git push origin v0.4.1`
- STOP before npm publish (OTP — hand back to David)

## 3. Out of Scope

- **Sleep pipeline implementation** — separate (eventual) sprint; needs LLM provider first.
- **`arcana-provider-llm-claude-code`** — separate sprint per ADR 012; not blocking factRetrieval.
- **`arcana-provider-llm-http`** — deferred per ADR 012 until a consumer demands.
- **`arcana-provider-postgres`** — deferred until Kyber in Cloud migration begins.
- **Block-zone facade work** — already done in v0.3.1.
- **`getEntityProfile` generalisation reduction** — per ADR 011 §"What this means for past work", the broader scope is additive (not divergent). Stays as-is. Not touched.
- **Resurrecting graph-BFS via getNeighbors in `factRetrieval`** — that's the v2 factRetrieval feature; deferred. The `structured.getNeighbors` provider method remains for other callers (entity-graph traversal in the new impl, future use cases).
- **Changing `FactRetrievalInput` or `HybridSearchResult` shape** — both stable; no contract changes.
- **npm publish** — OTP flow; David runs it.
- **KyberBot or Brain repo changes** — none.

## 4. Definition of Done

`git log --oneline -2` shows `feat` rebase commit + `chore` version-bump commit, both pushed to `origin/main`. `git tag` lists `v0.4.1` (pushed). `bun run build` exits 0. `bun run test` exits 0 with ≥ 260 tests (258 baseline + new layer tests minus replaced graph test, net ≥ +2). `packages/arcana-core/src/retrieve/index.ts → factRetrieval` no longer follows the Arcana-invented "listMemories → word-hit-score → getNeighbors expansion" path; replaced with the 4-layer KyberBot-faithful flow (FTS → entity → graph → bridge). CHANGELOG.md has a v0.4.1 section referencing ADR 011. Mochaccino reflects v0.4.1 state. Comms entry appended dated 2026-05-21. npm publish NOT executed.

## 5. Acceptance Criteria

| # | Criterion | How to check |
|---|---|---|
| 1 | `factRetrieval` ports KyberBot's 4-layer flow | Inspect `packages/arcana-core/src/retrieve/index.ts`; structure visibly matches KB's `fact-retrieval.ts` layers |
| 2 | No call to `structured.getNeighbors({ type: 'memory', ... })` from inside `factRetrieval` | `grep` confirms the deprecated memory-expansion path is gone |
| 3 | `structured.searchFulltext`, `structured.listEntities`, `structured.getFactsForEntity` are used by `factRetrieval` | `grep` confirms |
| 4 | Tests cover each layer (FTS, entity, graph, bridge) | New tests in `retrieve/index.test.ts` |
| 5 | Parity-harness smoke test exists | Test imports from `@kybernesis/arcana-testkit/parity`, runs `factRetrieval` as both baseline + candidate, asserts `passes: true` |
| 6 | Existing envelope-shape / empty-query / topK tests still pass | Vitest exit 0 |
| 7 | All 5 packages bumped to 0.4.1 | `grep -h '"version"' packages/*/package.json` reports `0.4.1` |
| 8 | `bun run build` succeeds | Exit code 0 |
| 9 | `bun run test` succeeds with ≥ 260 tests | Exit code 0; count check |
| 10 | CHANGELOG.md has v0.4.1 section referencing ADR 011 | `grep -A 2 "v0.4.1" CHANGELOG.md` returns expected content |
| 11 | Comms entry appended dated 2026-05-21 | `tail ~/dev/kybernesis/.comms/arcana-kyberbot.md` shows ARCANA → KBOT v0.4.1 entry |
| 12 | Mochaccino reflects v0.4.1 + rebased factRetrieval | `06-kernel-methods.json` entry updated; test count bumped; publish-pipeline gets v0.4.1 lane |
| 13 | Tag pushed | `git ls-remote --tags origin v0.4.1` returns the tag |
| 14 | npm publish NOT executed | `npm view @kybernesis/arcana-core@0.4.1 version` returns 404 |
| 15 | Two commits on main: feat + chore | `git log --oneline -2` shows both |
| 16 | Judgment calls during port documented in Findings appendix | Appendix in this plan populated with concrete resolutions (not just placeholders) |

## 6. Key References

- This plan: `/Users/davidcruwys/dev/kybernesis/arcana/docs/plans/2026-05-21-fact-retrieval-rebase.md`
- KyberBot source of truth (READ THIS FIRST): `/Users/davidcruwys/dev/kybernesis/kyberbot/packages/cli/src/brain/fact-retrieval.ts`
- KyberBot tests for behaviour cross-check: `/Users/davidcruwys/dev/kybernesis/kyberbot/packages/cli/src/brain/fact-retrieval.test.ts`
- Arcana target file: `/Users/davidcruwys/dev/kybernesis/arcana/packages/arcana-core/src/retrieve/index.ts`
- Arcana test file: `/Users/davidcruwys/dev/kybernesis/arcana/packages/arcana-core/src/retrieve/index.test.ts`
- ADR 011 (governing): `/Users/davidcruwys/dev/kybernesis/arcana/docs/decisions/011-port-first-improve-later.md`
- ADR 009 (parity gate): `/Users/davidcruwys/dev/kybernesis/arcana/docs/decisions/009-parity-gate-for-consumer-swaps.md`
- v0.4.0 sprint playbook (previous application of ADR 011): `/Users/davidcruwys/dev/kybernesis/arcana/docs/plans/2026-05-21-hybrid-search-rebase.md`
- Parity harness: `/Users/davidcruwys/dev/kybernesis/arcana/packages/arcana-testkit/src/parity/index.ts`
- Comms log: `/Users/davidcruwys/dev/kybernesis/.comms/arcana-kyberbot.md`

## Findings appendix

All six anticipated judgment calls resolved during the port. The first finding (Schema-depth divergence) is the foundational one and reframes the entire port from "1:1 algorithm + schema port" to "algorithm-shape port against Arcana's existing schema."

### Finding 0 (foundational) — Schema-depth divergence

**KyberBot's facts table** (read during the port from `kyberbot/packages/cli/src/brain/fact-retrieval.ts:113-280`) carries fields Arcana's `Fact` schema does not:
- `category` (e.g. 'general', 'personal-info')
- `source_path` (link back to a conversation segment via a `fact://parentId/index` URI)
- `source_conversation_id` (the parent conversation)
- `entities_json` (denormalised list of entities mentioned in the fact)
- Fact-level FTS5 index (`facts_fts` virtual table)

**KyberBot's `factSearch` return** is also structurally richer: `facts[]` + `supporting_context[]` + `assembled_context` (string) + `token_estimate` + per-layer `stats`.

**Arcana's `Fact` schema** is `{ id, fact, entity, attribute?, value?, confidence, sourceType, createdAt, lastReinforcedAt?, expiresAt?, isLatest, supersededBy?, surprisalScore?, scopes? }`. No `category`, no `source_path`, no fact-FTS5, no direct memory linkage.

**Arcana's `factRetrieval` contract** returns `QueryResult<HybridSearchResult[]>` — memory-shaped, not fact-shaped. No rich bundle.

**Resolution applied**: ported the *algorithm shape* (4 layers with KB's tuning), not the schema. The implementation operates against Arcana's existing memory + entity + edge tables, using `searchFulltext` (memory-level FTS5, not fact-level) for Layer 1 and entity-graph traversal for Layers 2–4. Each layer surfaces *memory ids*; the result builder maps them to `HybridSearchResult[]`.

**Deferred to v2 `factRetrieval`** (a future, larger sprint with consumer demand): schema-deepening of `Fact` (category, source_path, entities_json), fact-level FTS5 index in libsql, rich-bundle return shape (`supporting_context`, `assembled_context`, `token_estimate`, `stats`), proper fact↔memory linkage.

**Code locations**: this divergence is the load-bearing assumption for everything below. The v0.4.1 impl in `packages/arcana-core/src/retrieve/index.ts → factRetrieval` is honest about it via the leading comment block.

### Finding 1 — Layer-boundary semantics

**KB Layer 1** (`fact-retrieval.ts:113-280`): FTS over `facts_fts` virtual table + ChromaDB semantic search; dedup by content `wordOverlap > 0.8`; score `0.5 + matchRatio * 0.5`.

**KB Layer 2** (`fact-retrieval.ts:346-448`): seed-entity name match (substring) over `entities` table; 1-hop traversal of `entity_relations`; for each reached entity, `getFactsForEntity`; per-hop scoring with `HOP_PENALTY = { 0: 1.0, 1: 0.7, 2: 0.5, 3: 0.3 }`; non-seed entities filtered by query word-overlap > 0.1 to suppress noise.

**KB Layer 2.5/3** (scene + bridge — visible in the file's section banners): bridge facts surface when entity clusters intersect. (KB names this differently across the file; my impl uses "graph_expansion" for the 1-hop entity walk and "bridge" for the multi-entity connectivity case.)

**KB Layer 3 (supporting context)** (`fact-retrieval.ts:466-520`): for top N facts, find source conversation segments via `source_conversation_id`. Returns `SupportingChunk[]` with content + source_path + related_fact_id.

**Resolution applied (Arcana v0.4.1)**:
- Layer 1 — `structured.searchFulltext` (memory-level FTS5) with KB's `0.5 + matchRatio * 0.5` scoring formula.
- Layer 2 — `structured.listEntities({ nameContains: token })` per query token + `structured.getNeighbors({ type: 'entity', id })` for linked memories. Hop-0 score 1.0.
- Layer 3 — 1-hop entity traversal via two-step `getNeighbors` (seed entity → neighbor entities → their linked memories). Hop-1 score 0.7 × penalty(0.7).
- Layer 4 (bridge) — memories linked to ≥ 2 distinct seed entities; score 1.05 + (count-2)*0.03.
- Supporting context layer — **not ported**. Arcana facts don't have `source_conversation_id`; cannot reconstruct the supporting chunks. Queued for v2.

**Code locations**: `packages/arcana-core/src/retrieve/index.ts → factRetrieval` — each layer is a labeled section in the implementation.

### Finding 2 — Fact-graph traversal against Arcana's facts + edges schema

**KyberBot** uses `entity_relations` table for entity-to-entity graph walks (`fact-retrieval.ts:309-315`) and `getFactsForEntity` for entity-to-fact routing.

**Arcana** uses the unified `edges` table (with `from`/`to` carrying `{ type, id }` NodeRefs) for *all* graph relationships — entity-to-entity, entity-to-memory, memory-to-memory. The provider method `structured.getNeighbors({ type, id })` returns all neighbors regardless of relation type; the caller filters by `n.type === 'memory'` or `n.type === 'entity'`.

**Resolution applied**: traversal uses `structured.getNeighbors` for both entity-to-entity (Layer 3 seed → hop-1 entities) and entity-to-memory (Layer 2/3 entity → memory) walks, filtering by `n.type` per use case. This is more uniform than KB's split-table approach but produces an equivalent traversal graph at the algorithm level.

**Code locations**: `packages/arcana-core/src/retrieve/index.ts → factRetrieval`, Layer 2 and Layer 3 blocks.

### Finding 3 — Bridge layer implementation choice

**KyberBot's bridge layer** surfaces facts that *connect* distinct entity clusters surfaced earlier. The implementation is implicit in KB's combined `scene_expansion` + `bridge` flow; the result tagging `source: 'bridge'` appears at `fact-retrieval.ts:40`.

**Resolution applied**: explicit per-memory entity-coverage count. For each seed entity from Layer 2, walk neighbors to memories; count how many distinct seed entities each memory is linked to. Memories linked to ≥ 2 distinct seeds are bridges. Score: `1.05 + min(count-2, 5) * 0.03` (baseline above Layer 2's max 1.0 so bridges outrank single-entity matches).

**Layer-priority resolution**: when a memory is touched by *both* Layer 2 (entity_expansion) and Layer 4 (bridge), the `bump` function's priority order ensures `bridge` wins the `source` label even if its raw score happens to be lower. Priority order: bridge (4) > direct (3) > entity_expansion (2) > graph_expansion (1).

**Code locations**: `packages/arcana-core/src/retrieve/index.ts → factRetrieval`, Layer 4 block and the `LAYER_PRIORITY` constant + `bump` function.

### Finding 4 — Scoring weights

**KyberBot's scoring** (`fact-retrieval.ts`):
- Layer 1: `0.5 + matchRatio * 0.5` → 0.5–1.0 range (line 165)
- Layer 2 hop-0: baseScore `1.0` × `HOP_PENALTY[0]=1.0` → 1.0 (line 427)
- Layer 2 hop-1: baseScore `ef.confidence || 0.7` × `HOP_PENALTY[1]=0.7` → ~0.49 (line 427, 405)
- HOP_PENALTY constant: `{ 0: 1.0, 1: 0.7, 2: 0.5, 3: 0.3 }` (line 333-338)

**Resolution applied**: ported scoring constants verbatim. Layer 1 uses KB's `0.5 + matchRatio * 0.5`. Layer 2 uses `1.0 × HOP_PENALTY[0]`. Layer 3 uses `0.7 × HOP_PENALTY[1]` (default 0.7 confidence baseline since Arcana doesn't have per-fact confidence reaching Layer 3 in this v1 impl). Layer 4 (bridge) is Arcana-extended scoring (`1.05 + (count-2)*0.03`) because KB's bridge bonus isn't a single line — its bonus is implicit in the multi-pass nature of KB's `scene_expansion`. The Arcana value is a defensible "above any single-entity match" choice.

**Code locations**: `HOP_PENALTY` constant and the `bump()` calls per layer.

### Finding 5 — Query tokenization differences

**KyberBot's tokenization** (`fact-retrieval.ts:128-132`):
```ts
query.toLowerCase().replace(/[?.,!'"]/g, '').split(/\s+/).filter(w => w.length >= 3)
```

**Arcana's prior tokenization** (the old `factRetrieval` impl): `filter((w) => w.length > 2)`. Same threshold (3), different syntax. No punctuation stripping.

**Resolution applied**: ported KB's tokenization exactly, including the punctuation-strip step. This matters for queries like `"What's Anthropic?"` — KB strips the `'` and `?` before tokenizing, Arcana's old impl didn't. Result: `["whats", "anthropic"]` vs `["what's", "anthropic?"]`. The KB-faithful version matches more memories on natural-language queries.

**Code locations**: top of `factRetrieval` body in `retrieve/index.ts`.

### Finding 6 — Empty-result handling

**KyberBot's behaviour**: each layer is independent; a layer can return zero results without aborting the flow. If all layers produce nothing, the final return is an empty facts array + empty supporting_context + empty assembled_context. No throw.

**Resolution applied**: each layer is wrapped in `try/catch` with a debug-log on failure. A layer that errors or finds nothing contributes no bumps to the `scored` map. The final return is `[]` if all layers are empty. Behaviourally equivalent to KB.

**Code locations**: each layer block in `factRetrieval` has its own `try/catch` with a layer-specific debug-log key.

