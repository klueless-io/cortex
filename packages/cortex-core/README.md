# @kybernesis/arcana-core

The Arcana kernel — implements the portable-cortex pattern.

## Zones

Following the SPEC's zone layout:

```
src/
├── ingest/              ← storeMemory, ingestDocument
├── retrieve/            ← hybridSearch, factRetrieval, getEntityProfile
├── maintain/            ← sleep pipeline orchestration
└── access/
    ├── bindings/        ← createArcana() factory (T8)
    ├── query/           ← read-side facade (queryFacts, listContradictions, stats, ...)
    └── command/         ← write-side facade (recordFact, pin, moveToTier, ...)
```

Each zone exports a `createXxx(deps)` factory returning an API object. The factory pattern keeps providers injected via closure — no module-level state.

## v0.1 status

**Scaffold only.** Every zone method throws `NotImplementedError`. Real implementations land in v0.x, in order roughly matching the sleep-pipeline build order from `arcana-spec.md` §6.

The factory shape and method signatures are intentionally locked at v0.1 so `arcana-testkit` (T9) and `arcana-providers-libsql` (T10) can build against a stable surface.

## Usage (preview — T8 lands createArcana)

```ts
import { createArcana } from '@kybernesis/arcana-core';

const arcana = createArcana({
  structured: myStructuredStore,
  vector: myVectorStore,
  embed: myEmbeddingProvider,
  llm: myLLMProvider,
});

await arcana.ingest.storeMemory({ content: '...', source: 'cli' });
```

## License

MIT
