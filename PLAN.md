# Plan: Cortex

> **Status (2026-05-23, v2.0.0)**: The kernel is substantially complete and on npm. Sleep pipeline (10 KB-faithful steps), hybridSearch (4-channel), factRetrieval (5-layer), StructuredStore + VectorStore + LLMProvider + Scheduler contracts all live. KyberBot adoption swap is in progress (KyberBot-side work; runs through `runParityHarness` per ADR 009). For per-version release notes see [CHANGELOG.md](./CHANGELOG.md). For the audit-driven Phase 2/3 backlog see [docs/SYSTEM-HEALTH.md](./docs/SYSTEM-HEALTH.md). For sprint-level plans see [docs/plans/](./docs/plans/).
>
> Everything below this line is the **historical v0.1.0 plan**, retained for archaeology — the framing and the deferred items list no longer reflect current state.

---

# Historical: Cortex v0.1.0 → v0.x

> **Status update (2026-05-18)**: v0.1.0 scaffold is **substantially complete**. Strategy for what comes next has been revised — see "Strategy change" below.

## v0.1.0 scaffold — DONE

Three packages shipped, built, tested:

| # | Package | Status | Tests |
|---|---|---|---|
| ✓ | `@kybernesis/cortex-contracts` | Complete (T4 + T5) | 37 |
| ✓ | `@kybernesis/cortex-config` | Complete (T6) | 28 |
| ✓ | `@kybernesis/cortex-core` | Complete (T7 + T8) | 21 |
| | **Total** | | **86 across 19 files** |

Includes: 9 Zod schemas, 7 provider interfaces, Logger, QueryResult, three-layer config loader, kernel zone factories (`createIngest`, `createRetrieve`, `createMaintain`, `createQuery`, `createCommand`), and the `createCortex()` top-level factory. All kernel method bodies throw `NotImplementedError` — that's intentional; see strategy below.

## Strategy change — demand-driven kernel implementation

The earlier PLAN.md had T9 (testkit), T10 (libsql provider), T11 (ci.yml), T12 (publish) as the remaining v0.1.0 work. **All of those are now deferred** in favor of a demand-driven flow:

- Cortex kernel methods get implemented **as KyberBot adoption work demands them**, not against a tidy zone-by-zone TODO.
- The `NotImplementedError` thrown by each stub is the protocol message: "this method is needed, implement it next."
- KyberBot adoption runs in a separate Claude Code session at `~/dev/kybernesis/kyberbot/` — it consumes Cortex via a local workspace dep, not from npm.
- Kybernesis Brain adoption follows the same playbook but is handed off to Ian via a parallel doc.

See `docs/adoption/kyberbot.md` for the adoption playbook and `docs/adoption/kybernesis-brain.md` for the handoff template.

### Deferred items (revisit when demand justifies them)

| ID | What | When to revisit |
|---|---|---|
| T9 | `arcana-testkit` (provider compliance harness) | When a second provider needs cross-implementation validation. Not before. |
| T10 | `arcana-providers-libsql` (reference impl) | After KyberBot has lifted its libsql code into Cortex via adoption — at that point, the libsql provider is mostly already written. |
| T11 | `.github/workflows/ci.yml` | When there's a remote and a PR flow. We're local-only right now. |
| T12a | Manual npm publish | When Ian reserves `kybernesisai` org on npm AND consumers genuinely need cross-machine install (not just two David machines via syncthing). |
| T12b | CI publish + idempotency | After T12a. |

## v0.x — kernel implementations (active work)

Methods get implemented in the order KyberBot adoption demands them. Each implementation:

1. Lands as its own small commit in Cortex
2. Replaces the corresponding stub
3. Gets a real unit test in the relevant zone's `*.test.ts`
4. Updates `.mochaccino/data/` to reflect what's now real vs still stubbed

There is **no fixed order** beyond what KyberBot encounters first. The brain doc's algorithm specs in `~/dev/ad/brains/kybernesis/arcana-spec.md` §5-§10 are the canonical reference for *how* each method should behave; this PLAN doesn't restate them.

## Cross-session communication

Two Claude Code sessions run in parallel:

| Session | Cwd | Role |
|---|---|---|
| Cortex session (this one) | `~/dev/kybernesis/arcana/` | Implements kernel methods on demand |
| KyberBot session | `~/dev/kybernesis/kyberbot/` | Drives adoption; rips out `packages/cli/src/brain/*` module by module |

The communication protocol is described in `docs/adoption/kyberbot.md` under "Cross-session protocol."

## Local consumption (no npm)

KyberBot references Cortex via `pnpm` `file:` deps:

```json
"dependencies": {
  "@kybernesis/cortex-contracts": "file:../../arcana/packages/cortex-contracts",
  "@kybernesis/cortex-config": "file:../../arcana/packages/cortex-config",
  "@kybernesis/cortex-core": "file:../../arcana/packages/cortex-core"
}
```

Each Cortex rebuild + `pnpm install` in KyberBot refreshes the consumed code. Works across David's two machines via syncthing of the `~/dev/kybernesis/` directory.

## What hasn't changed

- SPEC.md remains the canonical build contract
- The architectural design source (`~/dev/ad/brains/kybernesis/arcana-spec.md`) remains authoritative
- The portable-cortex pattern remains the architecture
- The decisions locked in earlier (decay 2%/wk floor 0.30, RRF default, ARP scopes first-class, etc.) remain locked
- The "build-as-documented" Mochaccino boundary rule remains in force
