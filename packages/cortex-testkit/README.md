# @kybernesis/arcana-testkit

In-memory fake providers for testing Arcana consumers.

## Scope

Each `createFakeX()` factory returns an object that satisfies the corresponding Arcana provider interface from `@kybernesis/arcana-contracts`. Backed by JavaScript Maps + no persistence. Methods irrelevant to your test return sensible empty/no-op defaults rather than throwing.

This package exists so consumers can wire up `createArcana(...)` in tests with all four required providers without standing up libsql, ChromaDB, OpenAI, etc.

## Usage

```ts
import { createArcana } from '@kybernesis/arcana-core';
import {
  createFakeStructuredStore,
  createFakeVectorStore,
  createFakeEmbeddingProvider,
  createFakeLLMProvider,
} from '@kybernesis/arcana-testkit/fakes';

const structured = createFakeStructuredStore();
const arcana = createArcana({
  structured,
  vector: createFakeVectorStore(),
  embed: createFakeEmbeddingProvider(),
  llm: createFakeLLMProvider(),
});

await structured.connect();
const id = await arcana.ingest.storeMemory({ content: 'hello', source: 'cli' });
const memory = await structured.getMemory(id);
expect(memory?.content).toBe('hello');
```

## Parity harness — `./parity` subpath (since v0.3.0)

`runParityHarness` is a generic top-N overlap test for consumer swaps. When a consumer (KyberBot, Brain, KyberAgent Desktop) has a working in-house implementation of a capability and wants to swap to the Arcana kernel equivalent, ADR 009 mandates a parity test before the swap merges. This harness is the shared comparison engine.

Caller supplies a query corpus + two implementations + an id-extraction function. The harness runs every query through both, computes overlap per query, and aggregates a pass/fail report.

```ts
import { runParityHarness } from '@kybernesis/arcana-testkit/parity';

// KyberBot hybrid-search swap example
const report = await runParityHarness({
  queries: [
    { id: 'kyb-q1', input: { query: 'kybernesis architecture' } },
    { id: 'kyb-q2', input: { query: 'arcana provider' } },
    // ...50+ representative queries from your real workload
  ],
  baseline: async (input) => {
    // The proven-working impl
    return kybernesisHybridSearch(input as Query);
  },
  candidate: async (input) => {
    // The kernel impl under consideration
    return arcana.retrieve.hybridSearch(input as Query);
  },
  extractIds: (result) => result.data.map((r) => r.memory.id),
  topN: 10,
  threshold: 0.8,
});

if (!report.passes) {
  console.log(`Parity failed: mean overlap ${report.meanOverlap}`);
  for (const q of report.perQuery) {
    if (q.overlap < 0.8) {
      console.log(`  ${q.queryId}: missing ${q.missingFromCandidate}`);
    }
  }
}
expect(report.passes).toBe(true);
```

### Defaults

- `topN: 10` — compare top 10 results from each side
- `threshold: 0.8` — mean overlap ≥ 80% to pass

Both are tunable per capability. ADR 009 §"Why 80%, not 100%" explains the rationale: the kernel impl can legitimately improve on the baseline; demanding 100% would freeze quality at parallel-impl level forever.

### Error handling

If `baseline` or `candidate` throws on a given query, the error is captured on `perQuery[i].error` with its `side`, and that query contributes `overlap: 0`. The run does not abort — partial failure is visible in the report.

### What's NOT in the harness

- **Fixture seeding** — caller seeds their store before invoking the harness. The harness is pure: queries in, comparison out.
- **Order-aware scoring** (NDCG, Spearman ρ) — top-N overlap is order-insensitive; ADR 009 lists ranked scoring as future evolution.
- **Multi-version parity batteries** — single baseline vs single candidate per call. Caller can compose multiple runs.

See [ADR 009](../../docs/decisions/009-parity-gate-for-consumer-swaps.md) for the full methodology.

## What's NOT here

- A cross-provider **compliance suite** (`runComplianceSuite(provider)`) — that's deferred until a second real provider exists alongside libsql. The original v0.1 T9 plan included it; the demand-driven build defers it.
- Realistic latency / failure injection — fakes return synchronously-ish via `async`/`await`. No artificial delays, no flaky-network simulation.
- Persistence — Maps are wiped between test runs.

## License

MIT
