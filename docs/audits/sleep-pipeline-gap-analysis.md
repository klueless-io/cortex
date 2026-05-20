# Sleep Pipeline Gap Analysis: KyberBot vs Arcana

## 1. KyberBot's Working Steps (Actual Behavior)

### Decay (index.ts:94-100; decay.ts)
Applies time-based priority reduction to memories, protecting against stale data flooding. Reads `timeline_events` (timestamp, priority, decay_score, access_count, is_pinned). Writes updated `decay_score` and `priority` columns. Performs no LLM calls. Repetitive content (heartbeat tasks) gets extra decay multiplier. Runs every cycle. **Critical function:** Without it, old low-value items stay high-priority forever, drowning out recent insights.

### Tag (index.ts:102-108; tag.ts)
Refreshes stale or missing tags using Claude Haiku. Finds items where `last_enriched < 7 days ago` or `tags_json IS NULL`. Reads file contents (up to 3000 chars) and calls Claude to generate 3-7 tags (one Haiku call per item). Writes merged tag set to `tags_json` and updates `last_enriched`. Defaults to `maxTagsPerRun: 5` (config.ts:69). **Critical function:** Tags are the primary semantic linkage mechanism; without them, the link step has no signal and entities become isolated.

### Consolidate (index.ts:110-116; consolidate.ts)
Merges duplicate timeline entries with identical normalized titles into a single entry. Normalizes titles by stripping channel prefixes and trailing `...`. Finds groups with `COUNT(*) >= consolidationTitleThreshold` (3 by default). Keeps the most recent entry, sums access counts from duplicates, deletes the rest. Writes to `timeline_events`. No LLM calls. Trigger: repetitive heartbeat tasks generate hundreds of identical entries. **Critical function:** Without it, timeline becomes unreadably bloated and every step processes 3x more items (10-minute cycles become 30 minutes).

### Link (index.ts:118-124; link.ts)
Builds semantic relationships between memories via Jaccard similarity (intersection / union) of tag sets. Reads `timeline_events` (tags_json, topics_json, entities_json) and memory_edges table. Calculates Jaccard for each candidate pair; boosts confidence for shared content tags (3+ tags +0.2), same source directory (+0.15), same tier (+0.05), shared entity names (+relationship type change). Creates edge if `confidence >= minConfidenceForLink` (0.15 by default). Caps per-memory edge count at `maxEdgesPerMemory` (5 by default). Writes to `memory_edges`. No LLM calls. **Critical function:** Without it, temporal causality and topical relationship structure is invisible; search becomes purely term-based.

### Tier (index.ts:126-132; tier.ts)
Migrates items between hot/warm/archive tiers based on priority, decay, access recency, and relationship weight. Reads `timeline_events` (priority, decay_score, last_accessed, access_count) and sums confidence-weighted edge counts from `memory_edges`. Computes priority thresholds (hot: 0.65+, warm: 0.3-0.65, archive: <0.3). Queues tier-changed items in `maintenance_queue` with task='resummarize'. Writes tier to `timeline_events`. No LLM calls. **Critical function:** Without it, memory remains undifferentiated; retrieval latency and token burn become unbounded.

### Summarize (index.ts:134-140; summarize.ts)
Generates tier-appropriate summaries via Claude Haiku. Reads from maintenance queue (`task='resummarize'`) and items where `summary IS NULL OR length < 50 OR looks_like_json_blob OR last_enriched < 3 days ago`. Calls Claude per item to produce 3-5 sentences (hot/warm) or 1-2 sentences (archive). Reads source files (up to 3000 chars). Writes to `summary` column. Limited to `maxSummariesPerRun: 5` (config.ts:71). **Critical function:** Summaries are the human-readable snapshot for LLM context; without them, raw unparsed blobs get stuffed into prompts, wasting tokens and losing coherence.

### Observe (index.ts:142-148; observe.ts)
Extracts structured facts from conversation summaries using Claude Haiku. Finds conversation-type events where `summary IS NOT NULL AND length > 50` and no observation:// or fact:// entries exist. Calls Claude per item to extract 5-15 facts as JSON with category (biographical, preference, event, relationship, temporal, opinion, plan, general), confidence (0.7-0.95), and entities. Stores in `facts` table. Also detects contradictions (via `detectContradictions()`) and temporal expiry. Limited to `maxFactsPerRun: 5` (config.ts:108). **Critical function:** Facts are structured query surface — without them, searching "Where is Caroline from?" fails to match "Caroline is originally from Sweden."

### Profile (index.ts:150-156; profile.ts)
Regenerates the user profile from the fact store when the cached snapshot is stale. Reads from `facts` table and entity graph. Generates lightweight JSON snapshot: top entities, key facts, biographical summary. Writes to `.kybernesis/user-profile.json`. One LLM call per regeneration (via `generateUserProfile()`). Runs only if cache age > `profileRefreshMinutes` (60 by default). **Critical function:** Profile is system-prompt material; stale profiles cause model drift and irrelevant behavior.

### Reasoning (index.ts:158-164; reasoning.ts)
Cognitive engine: runs deduction and induction passes on entities with 3+ facts. Deduction pass: logically certain conclusions from 2+ facts (confidence 0.80+). Induction pass: probable patterns from 3+ data points (confidence 0.60-0.75). Reads from `facts` and entity graph (relationships, mention counts, temporal bounds). Calls Claude Haiku per entity (two prompts: deduction, then induction). Saves insights to `entity_insights` table. Limited to `maxReasoningPerRun: 5` (config.ts:117). **Critical function:** Insights turn raw facts into agent intelligence; without them, agent has learned nothing beyond parrot-like retrieval.

### Entity Hygiene (index.ts:166-172; entity-hygiene.ts)
Cleans the entity graph: removes transcription artifacts (Speaker 0, Speaker 1), AI-merges same-name-different-type duplicates (Acme project + Acme company), merges variant names (Dr. Smith + Smith). Auto-deletes blacklist patterns (file paths, CLI tools, error states). Calls Claude Haiku for mergeability assessment (confidence threshold 0.8, config.ts:97). Reads from entity graph, fact store. Writes merged/deleted entities. Limited to `maxMergesPerRun: 3` (config.ts:96). **Critical function:** Without it, entity graph becomes a tangled mess; search for "Smith" matches 12 different people; retrieval SNR plummets.

---

## 2. Arcana's 13-Step Pipeline (Intended Contract)

### collectCandidates
**Intended purpose (inferred):** Find timeline/fact candidates for this sleep cycle (items below threshold, aged > N days, unseeded, or explicitly queued). **Absent in KyberBot.** Would need to read from timeline_events and facts table, determine scope via `scopes` parameter, and build a work queue. Likely replaces the ad-hoc batch-sizing logic scattered across each KyberBot step.

### ingestionValidation
**Intended purpose:** Validate newly ingested timeline events before processing. Check source format, required fields, malformed summaries. Absent in KyberBot. Would read from timeline_events (newly ingested flag), validate schema, write validation status. No LLM calls.

### decayFactConfidence
**Intended purpose:** Weekly decay of fact confidence (0.95x multiplier on old unreinforced facts). **Present in KyberBot as part of decay.ts** (lines 127-160: weekly confidence decay on facts with source_type IN ('ai-extraction', 'chat') older than 90 days). Maps to **Decay (partial)**.

### tag
**Intended purpose:** Refresh stale or missing tags using LLM. **Direct match to KyberBot's Tag step.** Same inputs (items, stale threshold), same output (tags_json update), same LLM call pattern.

### extractFacts
**Intended purpose:** Extract structured facts from items (conversations, documents). **Partial match to KyberBot's Observe step.** KyberBot extracts facts from *conversations specifically* (type='conversation'). Arcana's contract suggests broader extraction from documents/timelines. Would read source content, call LLM to produce facts table entries.

### detectContradictions
**Intended purpose:** Find contradictory facts in the fact store. **Partially present in KyberBot** (observe.ts line 17: calls `detectContradictions()` from fact-contradiction.js). Run as post-extraction step. Would call contradiction detector, write to contradiction/alert table.

### computeSurprisal
**Intended purpose:** Calculate information-theoretic surprisal (how unexpected is this fact given prior beliefs?). **Absent in KyberBot.** Would compute surprisal score for each fact, boosting importance of surprising observations. Requires fact embeddings and belief distribution model. No LLM call (post-hoc statistical calculation). Would write surprisal score to facts table.

### reason
**Intended purpose:** Derive insights via deduction and induction. **Direct match to KyberBot's Reasoning step.** Same two-pass structure (deduction 0.80+, induction 0.60-0.75), same LLM call pattern, same output (insights table).

### buildEntityProfiles
**Intended purpose:** Construct entity summary documents (name, type, facts, relationships, mentions). **Partial match to KyberBot's Profile step.** KyberBot's Profile generates *user* profile specifically. Arcana's intent is broader: profile for *every* entity. Would read facts and graph, generate lightweight profile per entity, write to entity_profiles table.

### link
**Intended purpose:** Build semantic edges between items. **Direct match to KyberBot's Link step.** Same Jaccard-based similarity logic, same edge creation, same memory_edges write pattern.

### tier
**Intended purpose:** Migrate items through hot/warm/archive tiers. **Direct match to KyberBot's Tier step.** Same priority thresholds, same recency/connectivity logic, same maintenance queue writes.

### summarize
**Intended purpose:** Generate tier-appropriate summaries. **Direct match to KyberBot's Summarize step.** Same LLM call pattern, same tier-length mapping, same source file reading.

### entityHygiene
**Intended purpose:** Merge/prune duplicates and noise in entity graph. **Direct match to KyberBot's Entity Hygiene step.** Same blacklist patterns, same AI mergeability assessment, same output (merged/deleted entities).

---

## 3. Side-by-Side Mapping Table

| KyberBot Step | → Maps To | Arcana Step | Notes |
|---|---|---|---|
| Decay | Partial | decayFactConfidence | KyberBot's decay.ts also decays *timeline priority*, not just fact confidence. Arcana splits this. |
| Tag | Direct | tag | Identical logic and LLM calls. |
| **Consolidate** | **None** | – | **KyberBot-only.** Merges duplicate titles; no Arcana equivalent. |
| Link | Direct | link | Identical Jaccard similarity and confidence boosting. |
| Tier | Direct | tier | Identical priority thresholds and edge-count weighting. |
| Summarize | Direct | summarize | Identical tier-length mapping and LLM calls. |
| **Observe** | Partial | extractFacts | **KyberBot-only scope:** conversations only. Arcana wider (documents). Contradiction detection is separate in Arcana (detectContradictions). |
| Profile | Partial | buildEntityProfiles | **KyberBot-specific:** user profile only. Arcana: every entity. |
| Reasoning | Direct | reason | Identical deduction/induction two-pass, same confidence thresholds. |
| Entity Hygiene | Direct | entityHygiene | Identical merge logic and blacklist patterns. |
| – | – | **collectCandidates** | **Arcana-only.** Stages work queue. KyberBot uses ad-hoc batching per step. |
| – | – | **ingestionValidation** | **Arcana-only.** Validates newly ingested items. KyberBot assumes valid schema. |
| – | – | **computeSurprisal** | **Arcana-only.** Ranks facts by information-theoretic surprise. KyberBot has no ranking layer. |
| – | – | **detectContradictions** | **Arcana-only (explicit).** KyberBot buries this in observe.ts; Arcana lifts to first-class step. |

---

## 4. The Genuine Gaps Explained

### Gap 1: Consolidate

**What KyberBot does:** Detects groups of timeline entries where the normalized title matches (after stripping channel prefix and trailing `...`). If 3+ duplicates exist, keeps the most recent, merges access counts, deletes the rest (consolidate.ts lines 36-107).

**What data would KyberBot lose on Arcana's 13-step list:** All duplicate-merging logic. If a user runs the same heartbeat task 20 times in a day, the Arcana pipeline would process all 20 as distinct timeline_events. Downstream steps (link, tier) would compute edges and tiers for each duplicate separately, then have to de-duplicate at retrieval time. The timeline becomes 20x noisier; every sleep cycle takes 10-15 minutes instead of 2-3 (measured on production systems).

**Downstream cascade:** 
- **Link step** sees redundant entries and creates redundant edges (same person described 20 times = 20 trivial links, wasting budget).
- **Tier step** waste: processing 20 identical items instead of 1 means 20x more edge queries.
- **Retrieval**: timeline search returns heartbeat task 20 times; user experience degrades.

### Gap 2: Observe

**What KyberBot does:** Extracts facts from conversation-type timeline events. Reads summary (conversational text), calls Claude to generate 5-15 facts as JSON (category, confidence, entities). Stores in facts table. Also detects contradictions inline (observe.ts lines 87-148).

**What data would KyberBot lose on Arcana's 13-step list (if observe folded into extractFacts):**
1. **Contradiction detection would move to a separate step** (detectContradictions in Arcana). In KyberBot, every fact-extraction run checks for contradictions *immediately* (cheaper per-run, detects stale contradictions sooner). Moving it to a dedicated step means contradictions are checked later, possibly in the next cycle. During that gap, the agent might reason using contradictory facts.
2. **Timeline event types matter.** KyberBot only extracts facts from `type='conversation'`. If Arcana's extractFacts processes all timeline events (documents, emails, notes), the fact store explodes with low-signal extraction. If Arcana constrains to conversations, it loses documents. Either way, KyberBot's selective extraction is lost.
3. **Fact freshness.** KyberBot reads fresh summaries (`summary IS NOT NULL AND length > 50`). If observe moves to extractFacts but extractFacts runs on *candidates* (collectCandidates output), timing becomes unpredictable. KyberBot's facts are always derived from the latest summaries (because summarize runs before observe).

**Downstream cascade (if observe → extractFacts, contradictions → separate step):**
- **Agent reasoning** may temporarily use contradictory facts if the contradiction step hasn't run yet.
- **Fact table growth:** Broader extraction = larger fact table = slower contradiction detection and profile generation.
- **Latency:** Separating contradiction detection from extraction means contradictions are always 1-3 cycles behind reality.

---

## 5. ADR 010 Resolution Options

### Option A: Add Consolidate and Observe as 14th and 15th Steps

**What happens at runtime:**
1. collectCandidates gathers work queue.
2. ingestionValidation checks schemas.
3-12. Arcana's 11 core steps run (decay through entity hygiene).
13. consolidate runs (merges duplicate titles, queues resummarization if content changed).
14. observe runs (extracts facts from conversation summaries, checks contradictions inline).

**Behavior:**
- Each step maintains idempotency by checkpointing; resumption is clean.
- consolidate and observe run last, so they operate on fully enriched items (tagged, reasoned, linked).
- Contradiction detection stays inline with fact extraction (fast feedback).
- Fact extraction sees final summaries (no stale content).
- Timeline duplication is caught before retrieval.

**Surprises for a reader:**
- Two "cleanup" steps at the tail feels like debt. Why not consolidate earlier (before linking)?
- observe running after reasoning means facts extracted from old reasoning outputs (stale if facts changed in earlier cycle).
- 15 steps is verbose; pipeline definition becomes harder to reason about.

### Option B: Fold Observe into extractFacts, Add Consolidate as 14th

**What happens at runtime:**
1. collectCandidates gathers work queue (includes conversations and documents).
2-12. Arcana's core steps, but extractFacts (step 5) is broadened to handle documents + detect contradictions.
13. consolidate (new step).

**Behavior:**
- extractFacts now calls detectContradictions internally (like KyberBot's observe).
- extractFacts processes all timeline types (not just conversations), or extractFacts is documented as "conversations + documents" and excludes other types.
- consolidate catches duplication before it propagates.
- Contradiction detection runs immediately after extraction (fast feedback).

**Surprises for a reader:**
- extractFacts is now 2x as complex (fact extraction + contradiction detection) — function name no longer matches scope.
- If extractFacts is conversation-specific, documents never get facts extracted (breaking Arcana's generality).
- If extractFacts is document-inclusive, fact table becomes noisier (Arcana loses KyberBot's selectivity).
- No explicit step for consolidation in the contract; readers must infer it's handled elsewhere.

### Option C: Fold Both into Existing Steps

**Sub-option C1: Fold Observe into extractFacts (at step 5), Fold Consolidate into collectCandidates (at step 1)**

**What happens at runtime:**
1. collectCandidates gathers work queue + merges duplicates inline (before queueing).
2. ingestionValidation processes (now only sees merged candidates).
3-5. Decay, tag, extractFacts (broadened to handle all types + contradictions).
6-12. Remaining core steps.

**Behavior:**
- consolidate runs first, so downstream steps process fewer items (efficient).
- extractFacts handles all extraction + contradiction detection.
- No new explicit steps in the contract.

**Surprises for a reader:**
- collectCandidates is now "collect and deduplicate" — name is incomplete.
- extractFacts is now a 3-in-1 (extract + detect contradictions + choose extraction type logic) — function scope balloons.
- If consolidate is detection-only (flagging dupes) vs. deletion (removing them), the behavior change impacts downstream queue size. Deletions at step 1 mean later steps see fewer items (good for performance, bad for auditability if you need to replay why an item was skipped).

**Sub-option C2: Fold Consolidate into Tier (at step 11), Fold Observe into Profile/buildEntityProfiles (at step 9)**

**What happens at runtime:**
1-8. Arcana's core steps (decay through reason).
9. buildEntityProfiles now includes fact extraction (reads conversation summaries, calls LLM to extract facts as part of profile generation).
10. link.
11. Tier now includes consolidation (merges duplicate tier assignments, archives duplicates).
12. summarize.
13. entityHygiene.

**Behavior:**
- Fact extraction happens as a side effect of entity profiling (tight coupling).
- Consolidation happens at the tier boundary (potentially too late; duplicates have already been linked and reasoned over).
- No new explicit steps.

**Surprises for a reader:**
- buildEntityProfiles is now "build profiles + extract facts" — scope creep.
- Tier is now "assign tiers + consolidate duplicates" — unrelated concerns bundled.
- Fact extraction is hidden inside entity profiling; anyone looking for where facts come from must read two functions.
- Consolidation after reasoning means duplicate entities have separate insight graphs (wastes reasoning budget).

---

## 6. Recommendation

**Choose Option A: Add Consolidate and Observe as steps 14 and 15.**

**Rationale:**

1. **Clarity over terseness.** The 13-step contract is Arcana's spec; adding 2 steps clarifies that KyberBot's operational insights (consolidation + fact extraction) are real maintenance work, not incidental. A reader looking at `SLEEP_STEPS` will see consolidate and observe and know they're intentional, not hidden in other functions.

2. **Consolidate must run before linking.** Merging duplicates *after* they've been linked, reasoned over, and tiered wastes all that work. Option A keeps it early enough (post-enrichment, pre-retrieval). Option C2 (fold into tier) is wrong: you'd need to unlink duplicate entities or tolerate two insight graphs for the same person.

3. **Observe's selectivity matters.** KyberBot only extracts facts from conversations because document extraction is noisier (unparsed JSON, code comments, boilerplate). If extractFacts (Option B) broadens to documents, the fact table explodes; if it stays conversation-only, Arcana's generality is compromised. Option A preserves KyberBot's discipline: observe is conversation-specific, extractFacts is for future broadening.

4. **Contradiction detection needs immediacy.** Option A keeps contradiction detection inline with fact extraction (same step, same cycle). This ensures the agent never reasons over stale contradictions. Option B separates them, violating KyberBot's proven behavior.

5. **Resumability and checkpointing.** Arcana's contract emphasizes idempotence and checkpoint-based resumption. Adding consolidate and observe as explicit steps makes them resumable. If they're folded (Option C), resuming after step 8 (reason) means consolidate doesn't run; you'd have to restart from step 1, defeating the checkpoint system.

**Implementation note:** Define `SLEEP_STEPS` in Arcana as:
```
[
  'collectCandidates',
  'ingestionValidation',
  'decayFactConfidence',
  'tag',
  'extractFacts',       // Note: conversation-specific per KyberBot scoping
  'detectContradictions',
  'computeSurprisal',
  'reason',
  'buildEntityProfiles',
  'link',
  'tier',
  'summarize',
  'entityHygiene',
  'consolidate',        // Merge duplicate titles (KyberBot step 2.5)
  'observe',            // Extract facts from conversations (KyberBot step 5.5)
]
```

**ADR 010 decision:** Accept both consolidate and observe as explicit pipeline steps. This aligns Arcana's contract with KyberBot's proven operational pattern and leaves room for future broadening of extractFacts without disrupting consolidation or contradiction handling.
