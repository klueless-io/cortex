# ADR 003 — Facts as memories vs facts as triples

**Status**: Accepted
**Date**: 2026-05-18
**Decider**: David Cruwys (AppyDave)
**Discovered by**: KyberBot adoption session (module #4 audit)

## Context

During KyberBot's audit of `packages/cli/src/brain/fact-store.ts` ahead of module #4 adoption, an architectural mismatch surfaced: KyberBot's "facts" and Arcana's `Fact` schema describe **different semantic concepts**.

| | KyberBot fact | Arcana `Fact` |
|---|---|---|
| Shape | Free-text sentence + entity list + category | Relational triple `(entity, attribute, value)` |
| Example | `"John works at Acme as the CTO"`, entities `['John', 'Acme']`, category `'biographical'` | `entity='John', attribute='employer', value='Acme', confidence=0.95` |
| Producer | `fact-extractor.ts` — Haiku LLM call that produces sentence-shaped "facts" (no decomposition) | A hypothetical structured extractor (e.g. Kybernesis Brain's GPT-4o-mini queue-worker pipeline that emits real triples) |
| Storage in KyberBot today | `fact_store` SQLite table + indexed in ChromaDB as a searchable text chunk | N/A — no consumer yet produces this shape |

The adoption playbook (`docs/adoption/kyberbot.md`) row 4 originally mapped `fact-store.ts → command.recordFact + query.queryFacts`. That mapping was authored as a guess without reading KyberBot's actual fact-store code. The guess was wrong.

## Decision

**KyberBot's facts mirror to `ingest.storeMemory`, not `command.recordFact`.**

`command.recordFact` and `query.queryFacts` remain `NotImplementedError` stubs in Arcana, awaiting a structured-triple-producing consumer.

### Concrete mapping for module #4 dual-write

Each KyberBot fact is treated as a sentence-shaped Memory and mirrored via `ingest.storeMemory`:

```ts
const tags = [
  `fact:category:${fact.category}`,         // 'fact:category:biographical'
  `source-type:${fact.source_type}`,        // 'source-type:ai-extraction'
  ...fact.entities.map(e => `entity:${e}`), // 'entity:John', 'entity:Acme'
  ...(fact.tags ?? []),
];

const arcanaSource = fact.source_type === 'chat' ? 'chat' : 'cli';

const memoryId = await arcana.ingest.storeMemory({
  content: fact.content,
  source: arcanaSource,
  tags,
  scopes: { project_id: fact.project_id, ... },
});

// Local fact_store row stores arcana_memory_id (singular)
```

KyberBot's local `fact_store` table stays as the primary index — full-text search, category filtering, ARP-scoped queries all stay local. The Arcana mirror adds the fact's content into the brain's canonical memory store, where it can participate in retrieval, edges, sleep-pipeline processing, etc.

## Rationale

### Why not Option A (degenerate triple wrapper)

Mapping KyberBot's sentence to a fake triple — e.g. `{entity: 'John', attribute: 'kbfact-sentence', value: 'John works at Acme as the CTO'}` — was considered and rejected.

- It waste's Arcana's relational query power: `queryFacts(entity, 'kbfact-sentence')` returning full sentences is a non-feature
- It conflates two different concepts under one schema, making future queries ambiguous
- The "attribute" field becomes a meaningless marker rather than describing a semantic predicate

### Why not Option C (defer mirror entirely from #4)

Considered making module #4 a no-op architecturally (just adding `arcana_fact_ids` column, no Arcana writes until module #5 fact-extractor is refactored to produce triples).

- Loses the value of module #4 — KyberBot's facts would not be searchable via Arcana retrieval
- KyberBot already indexes fact content into ChromaDB; the "fact = memory" pattern is established in the code; mirroring to Arcana's Memory is consistent with that existing pattern
- A no-op module is a process smell

### Why Option B works architecturally

Arcana's brain model holds two distinct surfaces for "things we know":
- **Memory**: the canonical content store. Arbitrary content, tagged, retrievable by hybrid search, traversed by edges.
- **Fact**: structured triples. Queryable by (entity, attribute) for things like *"what is David's role?"*.

KyberBot's data is well-suited to Memory but not to Fact. Future consumers that produce real triples will use `command.recordFact`. The two surfaces serve different consumers — and that's fine. Arcana's contract stays clean; no concept is forced into the wrong shape.

## Consequences

- `docs/adoption/kyberbot.md` migration table row 4 corrected to point at `ingest.storeMemory`
- Row 5 (`fact-extractor.ts`) reframed: same mirror unless KyberBot evolves to produce triples (a separate, deliberate decision)
- `command.recordFact` and `command.queryFacts` retain their NotImplementedError stubs; their adoption clock starts when a triple-producing consumer (likely Kybernesis Brain's queue-worker) demands them
- Ian's Kybernesis Brain adoption (`docs/adoption/kybernesis-brain.md`) should benefit from this distinction: his pipelines DO produce structured triples, so his fact migration WILL demand `command.recordFact` — and the implementation will be designed for the triple shape, not contorted to absorb sentences

## Process learning

This is the second time consumer code-audit corrected my upfront documentation (first was the `deleteEntity` gap that produced ADR 002). The pattern is now visible:

- Upfront documentation (playbook tables, mapping predictions) is **a hypothesis**, not a contract.
- Per-module consumer audits override the hypothesis.
- The audit-then-QUESTION-then-confirm rhythm is what's actually keeping the library coherent.

**Action**: stop trying to perfectly predict module-N adoption shapes before reading module-N code. The playbook table is illustrative, not authoritative. Each module's consumer-side QUESTION is the authoritative source on what's needed.

## References

- Comms exchange: `~/dev/kybernesis/.comms/arcana-kyberbot.md` 2026-05-18 14:30 (KBOT QUESTION) → 14:55 (ARCANA ANSWER+CORRECTION)
- `~/dev/ad/brains/kybernesis/arcana-spec.md` §5.3 — fact extraction comparison between KyberBot (realtime Haiku, sentence output) and cloud (sleep-pipeline, structured triples)
- ADR 002 — related procedural ADR (propose-before-implement)
- `packages/cli/src/brain/fact-extractor.ts:138` (in KyberBot) — actual code showing sentence-shaped output
- `packages/cli/src/brain/sleep/steps/observe.ts:183` (in KyberBot) — same shape used downstream
