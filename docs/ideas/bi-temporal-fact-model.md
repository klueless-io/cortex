# Bi-Temporal Fact Model — Research & Implementation Proposal

**Status**: Proposal (pre-decision)
**Date**: 2026-05-24
**Author**: David Cruwys
**Related ADRs**: ADR 006 (contradiction model), ADR 011 (port-first), ADR 013 (fact schema deepening)

---

## The One-Line Problem

Cortex can tell you *that* a fact was superseded. It cannot tell you *when* a fact was true in the real world, or answer "what did the system believe about this entity on date D?"

---

## Why This Matters — The Three Proof Queries

These three queries cannot be answered by the current Cortex schema, Ian's KyberAgent Cloud schema, or any competitor except Graphiti:

**Query 1 — Point-in-time belief**
> "What did the system believe about Alice's employer on March 4th 2024?"

```sql
-- After bi-temporal change:
SELECT fact FROM facts
WHERE entities_json LIKE '%Alice%'
  AND (valid_at IS NULL OR valid_at <= '2024-03-04T00:00:00Z')
  AND (invalid_at IS NULL OR invalid_at > '2024-03-04T00:00:00Z')
```

**Query 2 — Complete history with date ranges**
> "Show me Alice's full employment history with when each job started and ended."

```sql
SELECT fact, valid_at, invalid_at FROM facts
WHERE entities_json LIKE '%Alice%'
  AND category = 'biographical'
ORDER BY COALESCE(valid_at, created_at)
```

**Query 3 — What changed its mind since a date**
> "Which facts has the system invalidated since January 2026?"

```sql
SELECT fact, invalid_at FROM facts
WHERE invalid_at >= '2026-01-01T00:00:00Z'
ORDER BY invalid_at DESC
```

None of these work today. All three work with two additive nullable columns.

---

## Ian Will Say He Already Has It — Here Is Why He Does Not

Ian's system has three things that sound like bi-temporal support. They are not.

### Claim 1: "I have `expires_at`"

**Ian's `fact-temporal.ts`** (kyberagent-cloud/apps/brain-daemon/src/brain/fact-temporal.ts):
```typescript
// Heuristic patterns — regex matching on fact content:
// "next week"   → +14 days
// "this weekend" → next Monday
// "tomorrow"    → +2 days
// "upcoming"    → +30 days
// "soon"        → +14 days
```

This is **forward-looking scheduled expiry** for reminder-style facts. It answers the question "should I still surface this fact?" not "when did this fact become true in the real world?"

`expires_at = "next Monday"` on the fact "I'm meeting John this weekend" is a cache-invalidation hint — not a temporal fact boundary.

Bi-temporal `invalid_at` is different in kind:
- Set by the **contradiction handler** when a newer fact logically supersedes an older one
- Answers "the fact 'Alice works at Company A' stopped being true on 2024-03-01 because a new fact 'Alice works at Company B' arrived with valid_at=2024-03-01"
- Ian's `expires_at` cannot express this. A fact about where Alice worked in 2020 has no temporal keyword in its text — the heuristic parser produces nothing.

**Evidence**: Ian's `fact-extractor.ts` extraction prompt does not ask Haiku for temporal bounds. The prompt requests `content`, `category`, `confidence`, and `entities`. No `valid_at` output field exists anywhere in Ian's extraction pipeline.

### Claim 2: "I have `is_latest` and `superseded_by`"

Ian's contradiction handler (`fact-contradiction.ts`) runs in the sleep agent's `observe` step. When Haiku identifies that a new fact updates an old one, it calls:

```typescript
await markFactSuperseded(oldFactId, newFactId)
// Sets: is_latest = 0, superseded_by = newFactId
```

This tells you **which fact won**, not **when the losing fact stopped being true**. The record "Alice works at Company A, is_latest=0, superseded_by=42" says nothing about whether Company A was valid for 3 years or 3 days. You cannot reconstruct a timeline from this.

Cortex's own ADR 006 made the same architectural choice — `markFactSuperseded` was deliberately designed as a pure-link primitive with no temporal mutation. This was the right call for the port-first phase. It is now the gap.

### Claim 3: "I detect contradictions with Haiku"

Ian's contradiction detection uses Haiku to classify relationships as `"updates"` or `"extends"` — a semantic comparison, not a temporal one. The output is an index list of fact IDs. The handler then sets `is_latest=0`. No timestamp is inferred or stored for when the contradiction logically took effect.

**The key difference from Graphiti's contradiction handler**:
- Ian: LLM says "fact B semantically updates fact A" → `A.is_latest = 0`
- Graphiti: LLM says "fact B contradicts fact A" → code sets `A.invalid_at = B.valid_at` (deterministic, not LLM-set)

The timestamp assignment in Graphiti is **code logic**, not LLM inference. The LLM only identifies which facts conflict. The temporal anchoring is derived from `valid_at` already on the new fact. This is why it's reliable — the LLM cannot hallucinate a timestamp that was never asked for.

---

## What Graphiti Actually Does (Code-Level Evidence)

**Repository**: `~/dev/upstream/repos/graphiti/`

### The Schema (graphiti_core/edges.py:263-286)

All temporal fields live on `EntityEdge` (facts/relationships), not on nodes:

```python
class EntityEdge(BaseModel):
    created_at: datetime          # REQUIRED — when system recorded it
    valid_at:   datetime | None   # NULLABLE — when fact became true in world
    invalid_at: datetime | None   # NULLABLE — when fact stopped being true
    expired_at: datetime | None   # NULLABLE — when system detected the invalidation
    reference_time: datetime | None  # NULLABLE — episode timestamp used as context
```

All four temporal fields beyond `created_at` are nullable. This is the key safety property — the entire model is additive.

### Contradiction Resolution (graphiti_core/utils/maintenance/edge_operations.py:537-572)

```python
def resolve_edge_contradictions(resolved_edge, invalidation_candidates):
    for edge in invalidation_candidates:
        if edge.valid_at < resolved_edge.valid_at:
            # New fact is more recent — old fact is now invalid
            edge.invalid_at = resolved_edge.valid_at   # WHEN it stopped being true
            edge.expired_at = utc_now()                # WHEN we detected it
            invalidated_edges.append(edge)
    return invalidated_edges
```

The code is mechanical. The LLM (`dedupe_edges.py`) returns a list of integer indices for contradicted facts. The timestamp assignment (`invalid_at = resolved_edge.valid_at`) is pure code — no LLM call, no hallucination risk.

### Temporal Extraction Prompts (graphiti_core/prompts/extract_edges.py)

Three separate prompt functions handle temporal reasoning:

**Primary extraction** — the main edge extraction prompt includes:
```
DATETIME RULES
- If the fact is ongoing (present tense), set valid_at to the timestamp
  of the episode the fact originates from.
- If a change or termination is expressed, set invalid_at to the relevant timestamp.
- Leave both fields null if no explicit or resolvable time is stated.
- If only a year is mentioned, use January 1st at 00:00:00.
- Do NOT hallucinate or infer temporal bounds from unrelated events.
```

**Fallback extraction** — a standalone lightweight call for when the main pass didn't yield temporal data:
```
Given a FACT and its REFERENCE TIME, determine when the fact became true (valid_at)
and when it stopped being true (invalid_at).
Rules: resolve relative expressions ("last week", "2 years ago") using REFERENCE TIME.
If ongoing (present tense), set valid_at to REFERENCE TIME.
NEVER hallucinate dates.
```

**Batch fallback** — same as above but processes multiple facts per LLM call, order-preserving.

The anti-hallucination guard (`NEVER hallucinate dates`) appears in all three prompts independently — evidence they burned themselves on this and patched all paths.

---

## Current State of Cortex (Code-Level Evidence)

### What Cortex Has

**Fact schema** (`cortex-provider-libsql/src/schema.ts:54-73`):
```sql
CREATE TABLE IF NOT EXISTS facts (
  id              TEXT PRIMARY KEY,
  fact            TEXT NOT NULL,
  created_at      TEXT NOT NULL,        -- ✓ required, set at write
  last_reinforced_at TEXT,              -- ✓ optional, reinforcement tracking
  expires_at      TEXT,                 -- ✓ optional, scheduled expiry
  is_latest       INTEGER DEFAULT 1,    -- ✓ version chain
  superseded_by   TEXT,                 -- ✓ version chain
  -- ... other fields
);
```

**cortex-contracts FactSchema** (`cortex-contracts/src/fact.ts:44-77`):
```typescript
createdAt: z.string().datetime(),
lastReinforcedAt: z.string().datetime().optional(),
expiresAt: z.string().datetime().optional(),
isLatest: z.boolean(),
supersededBy: z.string().optional(),
```

### What Cortex Is Missing

| Field | Status | Why Missing |
|---|---|---|
| `valid_at` | ✗ Not present | Never specified — not in KyberBot source either |
| `invalid_at` | ✗ Not present | ADR 006 deliberately avoided temporal mutation |
| Extraction prompt asking for dates | ✗ Not present | Prompt ported from KyberBot verbatim (ADR 011) — KyberBot doesn't do this either |
| `expiresAt` enforcement | ✗ Schema only | No sleep step or retrieval filter uses it |
| Temporal retrieval channel | ✗ Deferred | ADR 011: ported hybridSearch has temporal channel as a stub |

### The Current Extraction Prompt (`cortex-core/src/ingest/index.ts:23-34`)

```
Extract 1-3 concrete facts about specific people, companies, or projects from this
conversation. Only clear, verifiable facts — skip vague observations, greetings,
and meta-commentary.

Each fact object has:
- "content": The fact statement (8-25 words, include names not pronouns)
- "category": One of: biographical, preference, event, relationship, temporal,
  opinion, plan, general
- "confidence": 0.5-0.9 (how confident you are)
- "entities": Array of person/entity names

Return a JSON array, or [] if no concrete facts.
```

No `valid_at`, no `invalid_at`, no date/time fields in the output schema. The prompt recognises `temporal` as a category but does not extract any temporal bounds.

### The Current storeContradiction (`cortex-core/src/access/command/index.ts:294-315`)

```typescript
storeContradiction: async (input) => {
  const candidate: Contradiction = {
    id: randomUUID(),
    factAId: input.factAId,
    factBId: input.factBId,
    status: input.status ?? 'pending',
    rationale: input.rationale,
    createdAt: new Date().toISOString(),
  };
  await deps.structured.storeContradiction(validated);
  // Both facts remain untouched — no mutation, per ADR 006
}
```

ADR 006 explicitly separated detection from resolution. The contradiction record is a pending link. Nothing sets `invalid_at`, nothing sets `is_latest=0` automatically. This was correct for port-first. It is now the seam where bi-temporal fits.

---

## The Implementation Plan

Everything below is additive. No existing queries break. No consumers need updating until they choose to opt in.

### Step 1 — Schema (Zero-Risk, Do This Before Migration Widens)

**SQL** (`cortex-provider-libsql/src/schema.ts`):
```sql
ALTER TABLE facts ADD COLUMN valid_at   TEXT;  -- when fact became true in world
ALTER TABLE facts ADD COLUMN invalid_at TEXT;  -- when fact stopped being true
```

Both nullable. All existing rows get `NULL` — semantically correct ("we don't know when this became true, only when we recorded it"). No migration required.

**cortex-contracts FactSchema** (`cortex-contracts/src/fact.ts`):
```typescript
validAt:   z.string().datetime().optional(),  // world-time lower bound
invalidAt: z.string().datetime().optional(),  // world-time upper bound
```

**RecordFactInput** (`cortex-core/src/access/command/index.ts`):
```typescript
validAt?:   string;  // caller or extraction provides if known
invalidAt?: string;  // usually set by contradiction handler, rarely by caller
```

**Cost**: ~30 lines across three files. No breaking changes.

### Step 2 — Wire Invalid_at into markFactSuperseded (One Line)

**Current** (`cortex-core/src/access/command/index.ts`):
```typescript
markFactSuperseded: async (oldFactId, newFactId) => {
  await deps.structured.markFactSuperseded(oldFactId, newFactId);
  // Sets: isLatest=false, supersededBy=newFactId
}
```

**After change** — pass the new fact's `valid_at` as the invalidation timestamp:
```typescript
markFactSuperseded: async (oldFactId, newFactId) => {
  const newFact = await deps.structured.getFact(newFactId);
  const invalidAt = newFact.validAt ?? newFact.createdAt;
  await deps.structured.markFactSuperseded(oldFactId, newFactId, invalidAt);
  // Sets: isLatest=false, supersededBy=newFactId, invalidAt=<when new fact became true>
}
```

The provider implementation adds one field to the UPDATE:
```sql
UPDATE facts SET is_latest=0, superseded_by=?, invalid_at=? WHERE id=?
```

**Cost**: ~5 lines. Provider interface gains one optional parameter.

### Step 3 — Extend the Extraction Prompt

**Where**: `cortex-core/src/ingest/index.ts` — the existing extraction prompt string.

**Add to the output schema description**:
```
- "valid_at": ISO 8601 UTC (e.g. "2024-03-01T00:00:00Z") — when this fact became
  true in the real world. Rules:
    · Ongoing/present-tense fact → use the reference_time value provided.
    · Explicit historical date in text ("joined in March 2024") → use that date.
    · No temporal anchor present → omit this field entirely.
- "invalid_at": ISO 8601 UTC — when this fact stopped being true. Set ONLY if the
  text explicitly states a past end ("used to work at", "left in December 2023").
  Otherwise omit.
  NEVER hallucinate or infer dates. If uncertain, omit.
```

**Also pass `reference_time`** (current ISO timestamp) as context alongside the conversation text. This enables the LLM to resolve relative expressions ("last week") against a known anchor.

**Expected coverage**: The prompt will populate `valid_at` on roughly 30–50% of facts (present-tense facts default to `reference_time`, explicit date references parse cleanly). `invalid_at` will populate on a smaller fraction (only facts about past states). The rest stay NULL — which is semantically correct and handled by the query patterns above.

**Cost**: ~15 lines (prompt extension + reference_time injection + output schema field parsing). No new LLM call. No latency increase.

### Step 4 — Sleep Pipeline: resolveContradictions Step

This step sits in the deferred v2 list already documented in `cortex-core/src/maintain/index.ts`. It is now motivated by bi-temporal needs.

**Where it fits in the sleep sequence**:
```typescript
export const SLEEP_STEPS = [
  'decayMemories',
  'refreshTags',
  'consolidateMemories',
  'linkMemories',
  'tierMemories',
  'summarizeMemories',
  'resolveContradictions',   // ← NEW — after summaries, before observe
  'observeConversations',
  'rebuildUserProfile',
  'runReasoning',
  'cleanEntityGraph',
]
```

**What it does**:
```typescript
async function resolveContradictions(deps) {
  // 1. Load all pending contradictions
  const pending = await deps.structured.getContradictions({ status: 'pending' });

  for (const c of pending) {
    const factA = await deps.structured.getFact(c.factAId);
    const factB = await deps.structured.getFact(c.factBId);

    // 2. Determine which fact is newer (prefer valid_at, fall back to createdAt)
    const aTime = factA.validAt ?? factA.createdAt;
    const bTime = factB.validAt ?? factB.createdAt;
    const [older, newer] = aTime < bTime ? [factA, factB] : [factB, factA];

    // 3. Set invalid_at on the older fact = when the newer fact became true
    const invalidAt = newer.validAt ?? newer.createdAt;
    await deps.structured.markFactSuperseded(older.id, newer.id, invalidAt);

    // 4. Resolve the contradiction record
    await deps.structured.updateContradiction(c.id, {
      status: 'auto-resolved',
      resolution: `${newer.id} supersedes ${older.id} from ${invalidAt}`,
    });
  }
}
```

This is Graphiti's pattern adapted to Cortex's existing contradiction architecture: detection is separate (happens in `observeConversations` via the ported KyberBot path), resolution is a dedicated sleep step. The LLM does not run here — it is pure timestamp arithmetic on data already in the database.

**Cost**: ~40 lines for the step implementation. One new provider method (`updateContradiction` to transition status).

### Step 5 — Enable the Temporal Retrieval Channel (Deferred Until Sleep is Live)

The temporal channel in `hybridSearch` is already planned (ADR 011 gap). Once `valid_at` / `invalid_at` exist and are being populated, enabling it is a retrieval filter:

```sql
-- Default filter applied to all fact queries in hybridSearch:
WHERE (valid_at IS NULL OR valid_at <= :asOf)
  AND (invalid_at IS NULL OR invalid_at > :asOf)
```

With `asOf = NOW()` as default, this makes hybridSearch return only currently-valid facts. With `asOf = <past date>`, it answers point-in-time queries. This is the query pattern from Query 1 above.

**Cost**: ~10 lines in the retrieval layer. Gated behind the sleep pipeline being live.

---

## Sequencing Recommendation

| Step | Timing | Risk | Unlocks |
|---|---|---|---|
| Schema columns + contracts | **Now** — before KyberBot migration widens | Zero | Everything below |
| Wire `invalid_at` into `markFactSuperseded` | **Now** — 5 lines, no breaking change | Zero | Contradictions start accumulating timestamps |
| Extend extraction prompt | After schema is in — same sprint | Low | ~30–50% of new facts get `valid_at` |
| `resolveContradictions` sleep step | After KyberBot migration | Low | Pending contradictions get temporal resolution |
| Temporal retrieval channel in hybridSearch | After sleep step is live | Low | Point-in-time queries work |

The first two steps are genuinely free — do them now. Schema columns that sit NULL for a month are costless. Schema columns that have to be migrated in after three consumers have adopted the current table are not.

---

## What This Does NOT Require

- **No new LLM model or provider** — the extraction change is a prompt extension on the existing call.
- **No new database** — two nullable TEXT columns in the existing facts table.
- **No change to any existing consumer** — KyberBot, KyberAgent Desktop, Ian's Cloud can all ignore the new fields until they're ready.
- **No breaking change to any existing query** — all current queries omit `valid_at`/`invalid_at` and will continue to return the same results. The temporal filter is opt-in.
- **No new sleep step before the migration** — Steps 1 and 2 are the only pre-migration work.

---

## Summary: Why Cortex Ends Up Ahead

| Capability | Ian's Cloud | Cortex Now | Cortex After |
|---|---|---|---|
| Record when fact was extracted | ✓ `timestamp` | ✓ `createdAt` | ✓ `createdAt` |
| Scheduled expiry hints | ✓ heuristic `expires_at` | ✓ schema (unenforced) | ✓ schema + enforced in sleep |
| Know which fact superseded which | ✓ `is_latest` + `superseded_by` | ✓ same | ✓ same |
| Know WHEN a fact became true in world | ✗ | ✗ | ✓ `valid_at` |
| Know WHEN a fact stopped being true | ✗ (only heuristic forward expiry) | ✗ | ✓ `invalid_at` set by contradiction handler |
| Point-in-time query ("what was true on date D") | ✗ | ✗ | ✓ |
| Full temporal history with date ranges | ✗ | ✗ | ✓ |
| Contradiction resolution sets temporal bounds | ✗ | ✗ | ✓ |
| LLM extraction of world-time dates | ✗ | ✗ | ✓ (extended prompt) |

The gap between Ian's system and Cortex-after is not complexity — it is two nullable columns, one prompt extension, and one sleep step. The gap between Cortex-after and Graphiti is that Graphiti has a batch timestamp fallback pass and a more mature prompt. Both are iterative improvements on top of the same schema foundation.

---

## Files That Change

| File | Change | Lines |
|---|---|---|
| `cortex-provider-libsql/src/schema.ts` | Two `ALTER TABLE` lines | +2 |
| `cortex-contracts/src/fact.ts` | Add `validAt`, `invalidAt` to FactSchema | +4 |
| `cortex-core/src/access/command/index.ts` | `markFactSuperseded` passes `invalidAt`; `RecordFactInput` gains two optional fields | +8 |
| `cortex-provider-libsql/src/libsql-structured-store.ts` | `markFactSuperseded` SQL update gains `invalid_at`; `storeFact` and `rowToFact` handle new fields | +10 |
| `cortex-core/src/ingest/index.ts` | Extraction prompt gains `valid_at`/`invalid_at` output fields + anti-hallucination rule; `reference_time` injected; output parser handles new fields | +20 |
| `cortex-core/src/maintain/index.ts` | Add `resolveContradictions` to `SLEEP_STEPS` | +1 |
| `cortex-core/src/maintain/resolveContradictions.ts` | New file — sleep step implementation | ~40 |

**Total**: approximately 85 lines net new code across 7 files, zero breaking changes.

---

*Sources verified against live code: 2026-05-24*
*Graphiti ref: `~/dev/upstream/repos/graphiti/`*
*Cortex ref: `~/dev/kybernesis/cortex/`*
*Ian's Cloud ref: `~/dev/kybernesis/kyberagent-cloud/apps/brain-daemon/src/brain/`*
