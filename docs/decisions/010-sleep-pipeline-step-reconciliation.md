# ADR 010: Sleep Pipeline Step Reconciliation — KyberBot 9 vs Arcana 13

**Date:** 2026-05-20
**Status:** Superseded by ADR 011 + v1.1.0
**Deciders:** David Cruwys
**Related:** docs/plans/2026-05-20-fts-and-hybridsearch.md, ADR 008, ADR 011, packages/arcana-core/src/maintain/index.ts

---

## Resolution (2026-05-22, v1.1.0)

Resolved under port-first (ADR 011). v1.1.0 ships KB's 10-step pipeline verbatim
(audit later confirmed KB has 10 steps, not 9 — `reasoning` was uncounted in
the original analysis below): `decayMemories → refreshTags → consolidateMemories
→ linkMemories → tierMemories → summarizeMemories → observeConversations →
rebuildUserProfile → runReasoning → cleanEntityGraph`. The five Arcana-invented
steps (`collectCandidates`, `ingestionValidation`, `extractFacts`-in-sleep,
`detectContradictions`, `computeSurprisal`) are deferred to v2 sleep, to be
considered only after KB consumes the v1 pipeline and a concrete consumer asks.

---

## Context

The Arcana kernel declares a 13-step sleep pipeline in `packages/arcana-core/src/maintain/index.ts`:

```
collectCandidates, ingestionValidation, decayFactConfidence, tag,
extractFacts, detectContradictions, computeSurprisal, reason,
buildEntityProfiles, link, tier, summarize, entityHygiene
```

KyberBot has a working 9-step sleep pipeline in production at `kyberbot/packages/cli/src/brain/sleep/index.ts`:

```
decay, tag, consolidate, link, tier, summarize, observe, profile, reasoning, entityHygiene
```

When the kernel sleep pipeline is implemented and KyberBot swaps to it, the two lists do not cleanly overlap. This ADR records the gap, the open design question, and the constraints on resolving it. The decision is deliberately deferred — sleep implementation is not in the current sprint and the gap does not need to be resolved before the rest of the kernel work proceeds.

---

## The two lists side-by-side

| KyberBot step | Arcana step(s) | Notes |
|---|---|---|
| decay | decayFactConfidence | Arcana operates on fact-confidence; KyberBot operates on memory-priority. Renamed and re-scoped, but the same intent. |
| tag | tag | Direct match. AI-refresh of stale tags via LLM. |
| **consolidate** | **(no Arcana equivalent)** | KyberBot merges near-duplicate timeline entries. Arcana has no step for this. |
| link | link | Direct match. Build relationships between memories via entity graph. |
| tier | tier | Direct match. Move items between hot/warm/archive based on signals. |
| summarize | summarize | Direct match. Regenerate summaries for changed items. |
| **observe** | **(no Arcana equivalent)** | KyberBot extracts structured observations from conversations. Arcana has `extractFacts` which may or may not absorb this. |
| profile | buildEntityProfiles | Direct match. Regenerate entity profiles from fact store. |
| reasoning | reason | Direct match. Deduction + induction on entities with ≥3 facts. |
| entityHygiene | entityHygiene | Direct match. De-dup entities, merge variants, prune graph. |

| Arcana step | KyberBot step | Notes |
|---|---|---|
| collectCandidates | (implicit in queue) | Arcana adds an explicit "what should we process this cycle?" step. KyberBot's queue serves this implicitly. |
| ingestionValidation | (no KyberBot equivalent) | Arcana adds schema/format validation as a distinct step. |
| extractFacts | (partial via observe) | Arcana extracts structured facts from text. KyberBot's `observe` is adjacent but produces "observations" not facts. |
| detectContradictions | (no KyberBot equivalent) | Arcana adds pairwise contradiction detection across facts. |
| computeSurprisal | (no KyberBot equivalent) | Arcana adds novelty scoring (Jaccard or entropy). |

---

## The open design question

Two pieces of KyberBot's pipeline have no clean home in Arcana's current step list:

1. **`consolidate`** — merging near-duplicate timeline entries. This is memory-level dedup, not entity-level. KyberBot relies on it to keep the timeline tidy.
2. **`observe`** — extracting structured observations from conversation transcripts. KyberBot's downstream code (profile, reasoning) depends on the observations table being populated.

Three possible resolutions:

### Option A — Add both as new Arcana steps (15-step pipeline)

Honest about consumer needs. New constants `consolidate` and `observe` join the locked `SLEEP_STEPS` array. KyberBot swaps cleanly.

- **Pro**: zero behavior loss on swap. No fold-in interpretation needed.
- **Con**: pipeline gets longer; the principled "13 steps" design intent is diluted.

### Option B — Fold `observe` into `extractFacts`, add `consolidate` only

Argue that an "observation" is a soft-shaped fact and a single LLM call could produce both. `consolidate` is its own concern (memory-level dedup) and gets added.

- **Pro**: reduces step count growth, preserves the principled fact-extraction shape.
- **Con**: needs careful prompt design so the merged step doesn't lose KyberBot's observation semantics. Risks silent behavioral drift between observations and facts.

### Option C — Fold both, no new steps

`observe` → `extractFacts` (per Option B). `consolidate` → roll into `entityHygiene` or `tier` (treat memory dedup as a hygiene operation).

- **Pro**: holds the line at 13 steps.
- **Con**: `consolidate` doesn't naturally fit `entityHygiene` (one is about entities, the other memories). Risk of conflating two concerns in one step.

A fourth option exists in principle — drop `consolidate` and `observe` entirely on the basis that they're KyberBot-specific concerns and don't belong in the canonical kernel pipeline — but this would force KyberBot to keep that logic in its own pre/post-processing layer outside the kernel, which violates the unification goal.

---

## Constraints on resolution

- **The pipeline order is load-bearing**. Some steps depend on earlier steps' output (e.g., `link` needs facts already extracted). Any addition must respect existing dependencies.
- **The list in `SLEEP_STEPS` is currently exported as a typed tuple**. Changes to it cascade through any consumer that destructures or pattern-matches on step names.
- **KyberBot's parity gate (ADR 009) applies**. The chosen resolution must produce sleep-pipeline output that passes parity against KyberBot's existing impl on a representative cycle.
- **Brain's needs are unspecified for sleep**. ADR 008 does not commit Brain to any specific sleep step set. Brain's design influence on this decision is limited until Brain runs a sleep cycle in anger.

---

## Decision

**Deferred.** This ADR exists to record the gap so it is not discovered mid-implementation, not to resolve it.

The decision will be revisited when sleep-pipeline implementation work begins, by which time:

- KyberBot's sleep tests will be available as fixture material for the parity gate.
- The `observe` vs `extractFacts` boundary will be clarified by actually writing the fact-extraction prompts and seeing whether observations naturally fall out.
- Brain may have begun sleep work, surfacing requirements that disambiguate the options.

Until then, `SLEEP_STEPS` stays at 13, the `runSleepPipeline` kernel method stays stubbed, and KyberBot's working pipeline stays untouched.

---

## Consequences of deferral

**Positive**

- No premature commitment to a step list that might be wrong.
- Sleep implementation can begin with the unambiguous steps (decay, tag, link, tier, summarize, reason, profile, entityHygiene, extractFacts, detectContradictions, computeSurprisal) while the contested two await resolution.

**Negative**

- KyberBot cannot fully swap its sleep pipeline to the kernel until this is resolved.
- Anyone reading `SLEEP_STEPS` today doesn't see the gap unless they also read this ADR.

**Mitigations**

- Reference this ADR from the `SLEEP_STEPS` declaration in `maintain/index.ts` (one-line comment).
- Re-visit when the next sprint focuses on sleep.
