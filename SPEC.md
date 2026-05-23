# Spec: Cortex

## Objective

Cortex defines the canonical knowledge-brain kernel for the Kybernesis product family — **KyberBot** (local agent runtime), **Kybernesis cloud** (multi-tenant memory SaaS), and future consumers (Kyber Desktop, embedded-in-Skills). Today KyberBot and Kybernesis cloud independently implement the same concepts — memory storage, fact extraction, sleep-pipeline maintenance, hybrid retrieval — with measurable drift (decay rates differ 2.5×, retrieval fusion algorithms differ, relation vocabularies are 15 vs 6). Cortex collapses that into one library all current and future Kybernesis products depend on.

**Authoring approach** (revised 2026-05-21 per [ADR 011](./docs/decisions/011-port-first-improve-later.md)): code is **ported from KyberBot's empirical `packages/cli/src/brain/*`** — same algorithm shapes, same scoring constants, same step orders, same SQL/FTS semantics. KyberBot is the harness whose brain code already works in production; Cortex is the portable extraction of that brain. Port-first; improvements are queued as v2 work behind a flag, never bundled with the initial port. The parity gate ([ADR 009](./docs/decisions/009-parity-gate-for-consumer-swaps.md)) is how we know a port is faithful.

It implements the **portable-cortex pattern**: a `kernel` (data model + sleep pipeline + retrieval logic) wrapped by pluggable `providers` (embedding, LLM, vector store, structured store, scheduler, queue) and `interfaces` (CLI, MCP, HTTP, channels, ingestion).

**Users**: KyberBot (Ian) and Kybernesis cloud (David, Martin). Secondary: any future Kybernesis product that needs the same memory primitives.

**Success looks like**: both consumers depend on `@kybernesis/cortex-*` for memory primitives; the next decay-semantics or relation-vocab change is made in one place, not two; drift between the two products stops compounding.

The architectural design source is `~/dev/ad/brains/kybernesis/arcana-spec.md` (kernel surface, sleep pipeline, gap analysis). This document is the **build contract**.

## Tech Stack

| | |
|---|---|
| Language | TypeScript 5.9+, strict mode, ESM-only |
| Runtime | Node 20+ (also: Convex runtime, Cloudflare Workers) |
| Build | Plain `tsc -b` per package — no bundler |
| Package mgr | Bun ≥ 1.3 (workspaces, install, test, build); **pnpm** for `publish -r` (workspace `:*` deps rewrite correctly) |
| Validation | Zod 3 (re-exported from `cortex-contracts`) |
| Tests | Vitest 4.x + `@kybernesis/cortex-testkit` (in-memory fakes + parity harness) |
| Logging | Injected `Logger` interface — no logger dependency |
| Publish | Manual: bump versions → `pnpm publish -r --otp <code>` (OTP-gated). CI publish workflow is queued. |
| License | MIT |
| npm scope | `@kybernesis/cortex-*`, public registry |
| Repo | `klueless-io/arcana` on GitHub, public |

## Commands

```bash
# Install (workspace root)
bun install

# Build all packages
bun run build              # runs tsc -b across workspaces

# Test
bun run test               # vitest run
bun run test:watch         # vitest

# Lint + typecheck
bun run lint               # eslint . --fix
bun run typecheck          # tsc --noEmit

# Per-package
bun --filter @kybernesis/cortex-core run build
bun --filter @kybernesis/cortex-core run test

# Release (manual)
bun run version:bump       # interactive version bump
git push --follow-tags     # CI takes over: tag → publish
```

## Project Structure

```
arcana/
├── packages/
│   ├── cortex-contracts/         → Zod schemas, TS types, Logger interface, QueryResult envelope
│   │   └── src/
│   │       ├── memory.ts           Memory / Chunk
│   │       ├── entity.ts           Entity
│   │       ├── edge.ts             Edge, NodeRef (discriminated union)
│   │       ├── fact.ts             Fact (entities[] denormalised), FactCategory, widenLegacyFact migration helper
│   │       ├── insight.ts          Insight, EntityProfile, ProfileEntry
│   │       ├── agent-self.ts       AgentSelf (Letta-style memory blocks + history)
│   │       ├── scopes.ts           ARP scoping fields (org_id, project_id, connection_id, source_did, classification)
│   │       ├── providers.ts        Provider interfaces (StructuredStore — with transaction() primitive — VectorStore, EmbeddingProvider, LLMProvider, RerankerProvider, Scheduler, JobQueue)
│   │       ├── logger.ts           Logger interface
│   │       └── query-result.ts     QueryResult<T> freshness envelope
│   │
│   ├── cortex-core/              → Kernel — pure logic, no I/O
│   │   └── src/
│   │       ├── config/             Zod-validated config loader (defaults → file → env). Absorbed from cortex-config (v0.x consolidation).
│   │       ├── ingest/             storeMemory (transaction-wrapped), extractFacts (entity-normalised), ingestDocument (stub)
│   │       ├── retrieve/           hybridSearch (4-channel RRF), factRetrieval (5-layer incl. direct fact-FTS)
│   │       ├── maintain/           Sleep pipeline (10 KB-faithful steps, single-flight-guarded, partial-failure-aware) + config.ts + steps/
│   │       └── access/
│   │           ├── bindings/       createCortex() factory
│   │           ├── query/          read-side facade (queryFacts, getNeighbors, listContradictions, listInsights, readBlock, getBlockHistory)
│   │           └── command/        write-side facade (recordFact, linkNodes, storeContradiction, updateMemory, markMemorySuperseded, markFactSuperseded)
│   │
│   ├── cortex-testkit/           → In-memory fakes + parity harness (runParityHarness for consumer swaps per ADR 009)
│   ├── cortex-provider-libsql/   → REFERENCE: StructuredStore impl — libsql + FTS5 + recursive-CTE multi-hop + transaction primitive
│   ├── cortex-provider-sqlite-vec/ → REFERENCE: VectorStore impl via sqlite-vec extension
│   └── cortex-provider-llm-claude-code/ → REFERENCE: LLMProvider impl — subprocess to local claude CLI (no API key; uses Claude Code subscription)
│
├── docs/
│   ├── SYSTEM-HEALTH.md            System-health audit (cross-layer patterns, phased remediation plan)
│   ├── decisions/                  ADRs 001-013 (see ./docs/decisions/README.md index)
│   ├── plans/                      Sprint plans (one per release)
│   ├── audits/                     Investigation-driven audits (sleep gap analysis, etc.)
│   └── reviews/                    Session checkpoints, handover docs
├── .github/workflows/              CI (lint, typecheck, test). Publish workflow queued.
├── .mochaccino/                    Live build documentation dashboards (data/*.json + views/*.html)
├── CHANGELOG.md                    Per-version release notes (the most trustworthy "what shipped" reference)
├── SPEC.md                        → This document (the build contract)
├── README.md
├── LICENSE                         MIT
├── package.json                   Workspace root
├── bun.lock                        Lock file (Bun)
├── tsconfig.base.json
└── eslint.config.mjs
```

## Code Style

Factory functions return plain objects with escape-hatch properties. No classes. DI through options.

```ts
// packages/cortex-core/src/access/bindings/createCortex.ts
import type {
  Logger,
  StructuredStore,
  VectorStore,
  EmbeddingProvider,
  LLMProvider,
} from '@kybernesis/cortex-contracts';

export interface CortexOptions {
  structured: StructuredStore;
  vector: VectorStore;
  embed: EmbeddingProvider;
  llm: LLMProvider;
  logger?: Logger;
  reranker?: RerankerProvider;
  installSignalHandlers?: boolean;  // false in tests
}

export interface Cortex {
  ingest: IngestApi;
  retrieve: RetrieveApi;
  maintain: MaintainApi;
  // Public escape hatches
  readonly providers: Readonly<CortexOptions>;
  readonly logger: Logger;
}

export function createCortex(opts: CortexOptions): Cortex {
  const logger = opts.logger ?? noopLogger;
  // ... wire up zones
  return { ingest, retrieve, maintain, providers: opts, logger };
}
```

**Naming**:
- Files: `kebab-case.ts`
- Exports: `camelCase` functions, `PascalCase` types
- Factories: `createX()` returning `X`
- Zod schemas: `MemorySchema`, inferred type `Memory = z.infer<typeof MemorySchema>`

**Subpath exports** (granular, tree-shakable):
```json
{
  "exports": {
    ".": "./dist/index.js",
    "./bus": "./dist/bus/index.js",
    "./lifecycle": "./dist/lifecycle/index.js",
    "./ingest": "./dist/ingest/index.js",
    "./retrieve": "./dist/retrieve/index.js",
    "./maintain": "./dist/maintain/index.js"
  }
}
```

## Testing Strategy

- **Framework**: Vitest 4.x, one config at repo root, per-package overrides allowed.
- **Location**: `packages/<pkg>/src/**/*.test.ts` co-located with sources.
- **Levels**:
  - **Unit** (kernel): pure-function tests against fakes from `cortex-testkit`. Cover decay math, RRF, Jaccard, tier classification.
  - **Compliance** (providers): every provider runs the `@kybernesis/cortex-testkit` suite. Same assertions across libsql / Convex / Chroma / OpenAI — that's how we know the contract holds.
  - **Integration**: one smoke test per provider that exercises createCortex() with real backends (libsql in tmpfile, etc.). Off the default CI path; run via `bun run test:integration`.
- **Coverage**: not enforced at v0.1.0. Targets land at v0.2.
- **No mocks of internals** — provide a fake adapter via `cortex-testkit` instead.

## Boundaries

**Always**
- Run `bun run typecheck && bun run lint && bun run test` before commit
- All public APIs typed with Zod schema or explicit TS types from `cortex-contracts`
- Provider implementations live in their own package, never reach into `cortex-core`
- Logger always injected, never imported from a logging library
- Subpath exports declared in `package.json` for every public entry point
- New provider → must pass the `cortex-testkit` compliance suite
- **Build-as-documented**: when closing a task, refresh affected `.mochaccino/data/*.json` files and regenerate Mocha views. Treated with the same status as "run tests before commit" — non-optional.

**Ask first**
- Adding any runtime dependency to `cortex-core` or `cortex-contracts`
- Changing a provider interface (breaks every implementation)
- Adding a new top-level package
- Changing the sleep pipeline step order or signatures
- Touching the publish/CI workflow
- Bumping a major version

**Never**
- Import a concrete logger (Pino, Winston, etc.) anywhere in the library
- Bundle providers into `cortex-core`
- Commit secrets, `.env`, or npm tokens
- Skip the compliance suite to "ship faster"
- Add code to consume Cortex inside this repo (consumers live elsewhere)
- Mix ESM and CJS — ESM-only, no dual builds
- Rename public API names *post-publish* without a major version bump and a deprecation cycle (pre-publish, renames are free — see [ADR 001](./docs/decisions/001-method-renames-before-publish.md))

## Current State (v1.2.0)

The original v0.1.0 success criteria have all been met (six packages publish to npm, the factory exists, the schemas exist, MIT license, no concrete-logger imports). For the live state of what's implemented vs stubbed, see [CHANGELOG.md](./CHANGELOG.md) and the `.mochaccino/` dashboards.

The current health bar:

- [x] `bun run build` exits 0
- [x] `bun run test` exits 0 with 350+ tests across all 6 packages
- [x] All six packages published to npm at v1.2.0
- [x] `createCortex()` wires ingest/retrieve/maintain/access zones; `cortex-testkit` provides in-memory fakes + parity harness
- [x] All data-model types from `arcana-spec.md` §10 exist as Zod schemas in `cortex-contracts`
- [x] No package depends on Pino or any concrete logger
- [ ] GH Actions `publish.yml` (queued — manual `pnpm publish -r --otp` works today)
- [ ] Provider compliance suite (queued — see [docs/SYSTEM-HEALTH.md](./docs/SYSTEM-HEALTH.md) L8 UT-001)

## Open Questions

Tracked here so they don't get lost. See [docs/SYSTEM-HEALTH.md](./docs/SYSTEM-HEALTH.md) Phase 2 / Phase 3 for the audit-tracked items.

1. **ARP scoping** — promote `project_id`, `connection_id`, `source_did`, `classification` to first-class kernel scoping vocabulary? Needs Martin (ARP steward) sign-off.
2. **Relation vocabulary** — unify the 15-type KyberBot vocab with the 6-type cloud vocab. Current proposal: 6 core + 9 extended.
3. **Identity layer** — `AgentSelf` supports Letta-style `memoryBlocks`; markdown `SOUL.md` integration shape TBD.
4. **Local-first default** — `cortex-provider-libsql` + `cortex-provider-sqlite-vec` is the "just works" stack today. Embedded HNSW package not on the roadmap unless a consumer needs it.
5. **Postgres provider** — gated on Kyber-in-Cloud migration off libsql. Consumer-driven; no work scheduled.
6. **HTTP LLM provider** — `cortex-provider-llm-http` is queued per [ADR 012](./docs/decisions/012-llm-provider-architecture.md). Consumer-driven.
7. **`ingestDocument`** — still stubbed in `ingest`; Ian (Kyber in Cloud) has implemented it on the cloud side. Spec sync pending.
8. **Sleep pipeline v2** — five Cortex-invented steps (`collectCandidates`, `ingestionValidation`, `extractFacts`-in-sleep, `detectContradictions`, `computeSurprisal`) are deferred from v1.1.0 per [ADR 011](./docs/decisions/011-port-first-improve-later.md). Schedule after KyberBot consumes v1 sleep.
