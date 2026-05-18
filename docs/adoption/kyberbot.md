# KyberBot → Arcana adoption playbook

How KyberBot incrementally rips out `packages/cli/src/brain/*` and replaces it with `@kybernesisai/arcana-*` imports.

This document is the **contract between two Claude Code sessions**:
- **Arcana session** at `~/dev/kybernesis/arcana/` — implements kernel methods on demand
- **KyberBot session** at `~/dev/kybernesis/kyberbot/` — drives the adoption

Read this top-to-bottom before starting adoption work. The flow only works if both sessions agree on the protocol.

---

## 0. One-time setup (KyberBot side)

### Branch, not worktree

**Don't do this work in a git worktree.** `file:` deps resolve relative to the package.json's location; a worktree puts package.json several directories deeper than its eventual home, breaking the relative path. Also: this branch will accumulate `file:` deps that only work on David's machines (where `~/dev/kybernesis/` layout is consistent via syncthing). Keep it isolated from `main`.

```bash
cd ~/dev/kybernesis/kyberbot
git checkout main
git checkout -b arcana-adoption
```

The `arcana-adoption` branch is **long-running**. It probably never merges to main until Arcana publishes to npm and the `file:` deps get swapped for version pins.

### Add the local deps

Edit `packages/cli/package.json` and add to `dependencies`:

```json
"@kybernesisai/arcana-contracts": "file:../../../arcana/packages/arcana-contracts",
"@kybernesisai/arcana-config":    "file:../../../arcana/packages/arcana-config",
"@kybernesisai/arcana-core":      "file:../../../arcana/packages/arcana-core"
```

(`kyberbot/` and `arcana/` are siblings under `~/dev/kybernesis/`, so `../../../arcana/...` is correct from `packages/cli/`.)

Then from the kyberbot repo root:

```bash
pnpm install
```

### Verify

```bash
pnpm --filter @kyberbot/cli exec node -e "
  const { createArcana } = require('@kybernesisai/arcana-core');
  console.log(typeof createArcana);
"
# expect: function
```

When Arcana's source changes, refresh in KyberBot with `pnpm install` (pnpm re-links the file: dep).

### Known risk — workspace:* resolution

`arcana-core/package.json` declares `"@kybernesisai/arcana-contracts": "workspace:*"`. That's a Bun-workspace protocol. When pnpm installs arcana-core via `file:`, it may fail to resolve `workspace:*` because KyberBot isn't part of Arcana's workspace.

**If pnpm install errors on that spec**: don't try to fix it yourself. Write a `NEEDS` entry in the comms file (`~/dev/kybernesis/.comms/arcana-kyberbot.md`) with the exact error. The Arcana session will either add a pnpm `overrides` block or rewrite Arcana's dep spec to use a version range. Fast turnaround.

## 0a. Arcana singleton — consumer-side design

**Arcana doesn't dictate how you create or hold the instance.** It just provides `createArcana(opts)` which is synchronous and returns the assembled object.

Suggested KyberBot-side pattern:

- `packages/cli/src/brain/arcana-singleton.ts` exports `getArcanaInstance()` and `initArcana()` / `disposeArcana()`
- The orchestrator calls `initArcana()` once at boot, after `identity.yaml` is loaded
- `initArcana()` reads identity.yaml, constructs concrete providers (libsql StructuredStore, ChromaDB VectorStore, OpenAI EmbeddingProvider, etc.), calls each provider's `.connect()`, then calls `createArcana({...providers})`
- `disposeArcana()` calls each provider's `.disconnect()` on shutdown

The provider interfaces declare `connect(): Promise<void>` and `disconnect(): Promise<void>` — your singleton lifecycle wraps these.

**Config sourcing** is also your call:
- Option A: Use `@kybernesisai/arcana-config`'s `loadConfig({env, filePath})` and map identity.yaml fields into Arcana's config shape
- Option B: Skip arcana-config entirely; hand-roll `ArcanaOptions` from identity.yaml directly

Either pattern is fine. Arcana has no opinion.

---

## 1. The demand-driven rule

> **Implement Arcana kernel methods only when KyberBot adoption work demands them.** Don't pre-implement against a tidy zone-by-zone TODO. The order is driven by what gets ripped out first.

Concretely:

- KyberBot session attempts to replace `brain/timeline.ts` (say) with `arcana.ingest.storeMemory(...)` calls
- That call throws `NotImplementedError: arcana-core/ingest.storeMemory is a v0.1 scaffold stub; real implementation lands in v0.x`
- KyberBot session **pauses adoption work**, opens or switches to the Arcana session, says "implement `ingest.storeMemory` next"
- Arcana session implements it, commits, KyberBot session resumes
- Repeat per module

This produces small, justified commits on both sides. No method gets implemented in Arcana that doesn't have a real caller.

---

## 2. Per-module migration recipe

For each `brain/<module>.ts` that gets replaced:

### Step 1 — Read the existing tests

Before touching the module:

```bash
cat packages/cli/src/brain/<module>.test.ts
```

These tests describe the behavior contract that the replacement must satisfy. If no tests exist, write minimal ones from inspection of the module's actual usage in callers — this protects the migration.

### Step 2 — Rename old, don't delete

```bash
git mv packages/cli/src/brain/<module>.ts packages/cli/src/brain/<module>.legacy.ts
```

Update any internal imports that still use the legacy file. The `.legacy.ts` stays around during the migration; it's a reference + rollback target.

### Step 3 — Write the new module

Create a new `packages/cli/src/brain/<module>.ts` that:
- Imports types from `@kybernesisai/arcana-contracts`
- Calls methods on an Arcana instance created via `createArcana(...)` at the KyberBot agent's boot
- Preserves the **public surface** the old module exposed (so callers don't have to change yet)

Example sketch for `timeline.ts`:

```ts
// packages/cli/src/brain/timeline.ts
import type { Memory } from '@kybernesisai/arcana-contracts';
import { getArcanaInstance } from './arcana-singleton.js';

export async function storeTimelineEvent(input: { /* old shape */ }): Promise<string> {
  const arcana = getArcanaInstance();
  return arcana.ingest.storeMemory({
    content: input.content,
    title: input.title,
    source: input.source ?? 'channel',
    // ...
  });
}
```

### Step 4 — Run KyberBot's tests

```bash
pnpm --filter @kyberbot/cli test -- <module>
```

One of three things happens:

| Outcome | What it means | Action |
|---|---|---|
| Tests pass | Arcana already had this implemented | Move on; delete `.legacy.ts` when confidence is high |
| `NotImplementedError` thrown | Arcana method exists as a stub | Switch to Arcana session, implement it |
| Real behavior mismatch | Arcana's shape doesn't match what KyberBot needs | Contract bug — fix in Arcana session, then retry |
| Test expectation wrong | KyberBot test was testing impl details, not behavior | Adjust the test (carefully — get a second look) |

### Step 5 — Implement the Arcana method (in Arcana session)

The Arcana session reads `~/dev/ad/brains/kybernesis/arcana-spec.md` for the canonical algorithm, implements the method in the relevant zone (replacing the `throw new NotImplementedError(...)` line with real code), adds a unit test, and commits.

Implementation discipline:
- Match the spec's behavior unless there's a documented reason to diverge
- Real test (not just "doesn't throw") — exercise inputs/outputs/edge cases
- Keep the commit small; one method per commit when possible

### Step 6 — Verify end-to-end, then archive the legacy

Once KyberBot tests pass against the new module + real Arcana impl:

```bash
git rm packages/cli/src/brain/<module>.legacy.ts
git commit -m "drop <module>.legacy.ts — Arcana adoption complete for this module"
```

---

## 3. Suggested migration order

KyberBot brain modules are roughly listed in dependency order. Lower-numbered items have fewer dependencies and should be ripped out first:

| Order | KyberBot module | Arcana methods it'll demand |
|---|---|---|
| 1 | `timeline.ts` | `ingest.storeMemory` (read methods stay local) |
| 2 | `entity-graph.ts` | `command.upsertEntity`, `command.deleteEntity`, `command.linkNodes` |
| 3 | `embeddings.ts` | provider wiring: `EmbeddingProvider` + `VectorStore` adapters around OpenAI + ChromaDB |
| 4 | `fact-store.ts` | `ingest.storeMemory` (KyberBot facts are sentence-shaped memories, not triples — see ADR 003. `command.recordFact` stays a stub.) |
| 5 | `fact-extractor.ts` | `ingest.storeMemory` flow (sentence-shaped). If/when evolved to produce structured triples → `command.recordFact` gets demanded; until then, sentence mirror via storeMemory. |
| 6 | `fact-contradiction.ts` | sleep step + contradiction storage |
| 7 | `fact-temporal.ts` | temporal expiry logic in fact storage |
| 8 | `fact-retrieval.ts` | `retrieve.factRetrieval` (multi-stage) |
| 9 | `hybrid-search.ts` | `retrieve.hybridSearch` (RRF + graph expansion + optional rerank) |
| 10 | `store-conversation.ts` | composition of ingest + downstream extraction |
| 11 | `sleep/*` | `maintain.runSleepPipeline` + 13 steps |
| 12 | `user-profile.ts` | `retrieve.getEntityProfile` (entity = user) |
| 13 | `messages.ts` | chat history surface — likely stays in KyberBot, not Arcana (interface layer) |
| 14 | `chromadb.ts` | provider lifecycle for VectorStore impl |
| 15 | `db-recovery.ts` | likely stays in KyberBot — operational, not kernel |

Items 13-15 may end up not migrating — they're interface-layer concerns (per SPEC's three-ring model). Decide on each as you reach it.

---

## 4. Cross-session protocol — comms file

Both sessions communicate via an append-only log at:

```
~/dev/kybernesis/.comms/arcana-kyberbot.md
```

Either session can write an entry. When you switch sessions, the user says "**check comms**" and that session reads the latest entries from the bottom of the file.

Entry format (most recent at bottom):

```
## YYYY-MM-DD HH:MM  SENDER → RECIPIENT  TYPE
<body>
```

Senders: `KBOT`, `ARCANA`.
Types: `NEEDS`, `IMPLEMENTED`, `QUESTION`, `ANSWER`, `NOTE`, `BLOCKED`.

### When KyberBot hits a stub (NEEDS)

```
## 2026-05-18 12:34  KBOT → ARCANA  NEEDS
arcana-core/ingest.storeMemory
called from: kyberbot/packages/cli/src/brain/timeline.ts:42
shape: input={content, source, ...}; returns memoryId string
spec ref: ~/dev/ad/brains/kybernesis/arcana-spec.md §5.1
```

### When Arcana session has finished implementing (IMPLEMENTED)

```
## 2026-05-18 12:48  ARCANA → KBOT  IMPLEMENTED
arcana-core/ingest.storeMemory
commit: abc1234
test count: 86 → 89
notes: validates input with MemorySchema before persistence; assigns id via crypto.randomUUID
```

### Why this beats copy-pasting blocks

- One source of truth instead of scrolling two transcripts
- Survives session closure — reopening either session, read comms, you're back in sync
- The user (David) only has to say "check comms" instead of ferrying blocks
- Append-only log doubles as a record of the migration history

---

## 5. What to do when something breaks

| Symptom | Likely cause | Where to fix |
|---|---|---|
| `NotImplementedError` thrown from Arcana | Stub still in place | Arcana session: implement the named method |
| TypeScript error on import from `@kybernesisai/arcana-*` | Contract drift between Arcana types and KyberBot expectations | Arcana session: revise contract (carefully — every consumer sees this); update both sides |
| Runtime error in Arcana code | Bug in the implementation | Arcana session: fix, add regression test |
| KyberBot test was testing implementation details (e.g., specific SQL emitted) | Old test was too coupled to the old impl | KyberBot session: rewrite test as a behavior test |
| `pnpm install` doesn't pick up Arcana changes | `file:` dep cache stale | `rm -rf node_modules` in kyberbot, re-`pnpm install` |
| Arcana rebuild not reflected | Stale `dist/` | In Arcana: `bun run build` |

---

## 6. When KyberBot adoption is "done"

The adoption is complete when:

- `packages/cli/src/brain/` no longer exists in KyberBot, OR contains only interface-layer concerns (messages, chromadb wiring, db-recovery) that were never in Arcana's scope
- All of KyberBot's tests pass with Arcana as the kernel
- KyberBot can run end-to-end (channel chat → memory store → retrieval → response) against a real libsql + ChromaDB backend, with Arcana doing all the brain work

At that point the local `file:` deps can be replaced with published npm versions (T12a returns from deferred). KyberBot becomes the first real-world Arcana consumer.

---

## See also

- `docs/adoption/kybernesis-brain.md` — parallel playbook for Ian's Kybernesis Brain repo
- `SPEC.md` — Arcana build contract
- `~/dev/ad/brains/kybernesis/arcana-spec.md` — canonical algorithmic spec for kernel methods
