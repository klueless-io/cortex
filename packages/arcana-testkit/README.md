# @kybernesisai/arcana-testkit

In-memory fake providers for testing Arcana consumers.

## Scope

Each `createFakeX()` factory returns an object that satisfies the corresponding Arcana provider interface from `@kybernesisai/arcana-contracts`. Backed by JavaScript Maps + no persistence. Methods irrelevant to your test return sensible empty/no-op defaults rather than throwing.

This package exists so consumers can wire up `createArcana(...)` in tests with all four required providers without standing up libsql, ChromaDB, OpenAI, etc.

## Usage

```ts
import { createArcana } from '@kybernesisai/arcana-core';
import {
  createFakeStructuredStore,
  createFakeVectorStore,
  createFakeEmbeddingProvider,
  createFakeLLMProvider,
} from '@kybernesisai/arcana-testkit/fakes';

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

## What's NOT here

- A cross-provider **compliance suite** (`runComplianceSuite(provider)`) — that's deferred until a second real provider exists alongside libsql. The original v0.1 T9 plan included it; the demand-driven build defers it.
- Realistic latency / failure injection — fakes return synchronously-ish via `async`/`await`. No artificial delays, no flaky-network simulation.
- Persistence — Maps are wiped between test runs.

## License

MIT
