# Cortex

The canonical knowledge-brain library for the Kybernesis product family.

Cortex defines the shared memory substrate consumed by **KyberBot** (local agent runtime), **Kybernesis cloud** (multi-tenant memory SaaS), and future Kybernesis products. It implements the **portable-cortex pattern** — a `kernel` (data model + sleep pipeline + retrieval logic) wrapped by pluggable `providers` (embedding, LLM, vector store, structured store, scheduler, queue) and `interfaces` (CLI, MCP, HTTP, channels, ingestion).

## Status

**v2.1.5 — Cortex (renamed from Arcana at v2.0.0), kernel stable, KyberBot active adoption with measured 0.877 factRetrieval parity on read-only fixtures (past the 0.8 swap gate).** All six packages publish to npm. The kernel ports KyberBot's empirical brain code per [ADR 011 — port-first, improve-later](./docs/decisions/011-port-first-improve-later.md): match the proven implementation before considering improvements. Sleep pipeline (10 KB-faithful steps), hybridSearch (4-channel RRF), factRetrieval (5-layer with direct fact-FTS + v2.1 layered-defence: stopwords + minMatchRatio + minTokenLength), the StructuredStore (now including `getEdgesFor` for full Edge metadata) / VectorStore / LLMProvider / Scheduler contracts, and a v0.x→v1.0.0 facts auto-migration in the libsql provider are all live. Remaining stubs are demand-driven (`ingestDocument`, three Convex-shaped facades).

System-health verdict at v2.1.5: **AMBER** — solid core, audit-known seams documented in [docs/SYSTEM-HEALTH.md](./docs/SYSTEM-HEALTH.md). Phase 1 production-blockers + Phase 2 ingest hardening (prompt-injection defence in `extractFacts`, soft-delete-aware fact extraction) shipped. Phase 2 retrieve correctness shipped (equal-score tiebreaker, additive keywordScore, tokenBudget enforcement, Layer-0 fan-out cap). Outstanding: the `Config` / `loadConfig` surface is exported but not yet routed into `createCortex` — see the STATUS notice at the top of `packages/cortex-core/src/config/config.ts`.

## Documentation

- [`SPEC.md`](./SPEC.md) — the build contract: tech stack, project structure, code style, boundaries
- [`CHANGELOG.md`](./CHANGELOG.md) — release notes per version (most trustworthy "what shipped" reference)
- [`docs/SYSTEM-HEALTH.md`](./docs/SYSTEM-HEALTH.md) — system-health audit (cross-layer patterns, phased remediation plan)
- [`docs/decisions/`](./docs/decisions/) — Architecture Decision Records ([README](./docs/decisions/README.md) indexes ADRs 001-013)
- [`docs/plans/`](./docs/plans/) — sprint plans (one per release; current and historical)
- [`.mochaccino/`](./.mochaccino/) — live build documentation dashboards

The architectural design source lives outside this repo: `~/dev/ad/brains/kybernesis/arcana-spec.md`.

## Install

```bash
npm install @kybernesis/cortex-contracts \
            @kybernesis/cortex-core \
            @kybernesis/cortex-provider-libsql \
            @kybernesis/cortex-provider-sqlite-vec \
            @kybernesis/cortex-provider-llm-claude-code
```

`@kybernesis/cortex-testkit` is dev-only (provider compliance suite + parity harness).

## Packages

| Package | Purpose |
|---|---|
| `@kybernesis/cortex-contracts` | Zod schemas (Memory, Fact, Edge, Entity, Insight, EntityProfile, Contradiction, AgentSelf), provider interfaces, `Logger`, `QueryResult<T>`, `Scopes` |
| `@kybernesis/cortex-core` | Kernel — `createCortex()` factory + `ingest`/`retrieve`/`maintain`/`access` zones |
| `@kybernesis/cortex-testkit` | In-memory fakes + parity harness (`runParityHarness`) for consumer swaps per [ADR 009](./docs/decisions/009-parity-gate-for-consumer-swaps.md) |
| `@kybernesis/cortex-provider-libsql` | Reference `StructuredStore` impl — libsql + FTS5 + recursive-CTE multi-hop graph + transaction primitive |
| `@kybernesis/cortex-provider-sqlite-vec` | `VectorStore` impl via the sqlite-vec extension |
| `@kybernesis/cortex-provider-llm-claude-code` | `LLMProvider` impl via subprocess to the local `claude` CLI (no API key required — uses Claude Code subscription) |

## Usage

```ts
import { createCortex } from '@kybernesis/cortex-core';
import { createLibsqlStructuredStore } from '@kybernesis/cortex-provider-libsql';
import { createSqliteVecVectorStore } from '@kybernesis/cortex-provider-sqlite-vec';
import { createClaudeCodeLLMProvider } from '@kybernesis/cortex-provider-llm-claude-code';

const cortex = createCortex({
  structured: createLibsqlStructuredStore('./cortex.db'),
  vector: createSqliteVecVectorStore('./cortex.db', { dimensions: 1536 }),
  llm: createClaudeCodeLLMProvider(),
  embed: yourEmbeddingProvider,
});

await cortex.providers.structured.connect();
const id = await cortex.ingest.storeMemory({ content: 'hello world', source: 'cli' });
const facts = await cortex.ingest.extractFacts(id);
const results = await cortex.retrieve.hybridSearch({ query: 'hello' });
await cortex.maintain.runSleepPipeline();
```

## License

[MIT](./LICENSE) © 2026 David Cruwys (AppyDave)
