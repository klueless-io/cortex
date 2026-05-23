# Plan — v2.0.0 Rename: arcana → cortex

**Date**: 2026-05-23
**Mode**: code
**Trigger**: KyberBot comms 2026-05-23 10:30 — `KybernesisAI/arcana` (Ian's cloud brain at `arcana.kybernesis.ai`) and `klueless-io/arcana` (this library) can't coexist under the same name. New name: **Cortex**, mapping cleanly to the library's identity (the brain kernel) — the README already calls the design pattern "portable-cortex".

**Version**: **v2.0.0** — npm scope/name change is breaking for any consumer. KyberBot is the only current consumer and has signed off in advance (comms 2026-05-23 10:30).

**Prerequisite (must be done first by David, manually)**: v1.2.1 must be published to npm and KyberBot parity-harness confirmed at meanOverlap ≈ 1.0. Without that, KyberBot can't validate the rename swap.

## 1. Scope

Six npm packages + their dirs + every import + the factory + types + the docs surface. Bulk mechanical with a few thoughtful renames.

| Old | New |
|---|---|
| `@kybernesis/arcana-contracts` | `@kybernesis/cortex-contracts` |
| `@kybernesis/arcana-core` | `@kybernesis/cortex-core` |
| `@kybernesis/arcana-testkit` | `@kybernesis/cortex-testkit` |
| `@kybernesis/arcana-provider-libsql` | `@kybernesis/cortex-provider-libsql` |
| `@kybernesis/arcana-provider-sqlite-vec` | `@kybernesis/cortex-provider-sqlite-vec` |
| `@kybernesis/arcana-provider-llm-claude-code` | `@kybernesis/cortex-provider-llm-claude-code` |
| `packages/arcana-*/` | `packages/cortex-*/` |
| `createArcana()` | `createCortex()` |
| `Arcana` type | `Cortex` type |
| `ArcanaOptions` | `CortexOptions` |
| `arcana.*` in logger debug strings | `cortex.*` |

## 2. Stack

Unchanged: 6 packages, bun + vitest + tsc, libsql + better-sqlite3 + sqlite-vec, pnpm publish.

## 3. In Scope — concrete changes by area

### A. Package directories + workspace wiring
- `git mv packages/arcana-X packages/cortex-X` for each of the 6 packages.
- Each package's `package.json` — update `name` field and any workspace `dependencies` / `devDependencies` referencing other packages.
- Root `package.json` — verify `workspaces` glob still matches (likely `packages/*` → no change needed). Update `name` if it has the old name.
- `tsconfig.json` (root) — update `references` paths.
- Per-package `tsconfig.json` — update `references` paths.
- `bun.lock` — regenerate via `bun install` after package.json changes settle.

### B. Imports across all source files
- Every `from '@kybernesis/arcana-contracts'` → `from '@kybernesis/cortex-contracts'`.
- Same for `arcana-core`, `arcana-testkit`, `arcana-provider-libsql`, `arcana-provider-sqlite-vec`, `arcana-provider-llm-claude-code`.
- Subpath imports too: `@kybernesis/arcana-testkit/fakes` → `@kybernesis/cortex-testkit/fakes`, `@kybernesis/arcana-testkit/parity` → `@kybernesis/cortex-testkit/parity`.

### C. Factory + types rename (caller-visible API)
- `createArcana()` → `createCortex()` in `packages/cortex-core/src/access/bindings/create-arcana.ts` — rename file to `create-cortex.ts`.
- Type `Arcana` → `Cortex`, `ArcanaOptions` → `CortexOptions`, `ArcanaApi` → `CortexApi`.
- Re-export from `cortex-core/src/index.ts`: `createCortex`, `Cortex`, `CortexOptions`.
- Logger debug strings: every `'arcana.ingest.X'` → `'cortex.ingest.X'`, `'arcana.retrieve.X'` → `'cortex.retrieve.X'`, etc. — these are observable in consumer logs so they count as caller-visible.
- Error messages: any `'arcana-core: ...'` strings → `'cortex-core: ...'`. Grep `arcana-core` to catch all.

### D. Docs — active surface (the rename's intent)
- `README.md` — top-to-bottom rewrite of the project name. Title, install commands, package list, usage example.
- `SPEC.md` — project name, package list in §Project Structure, all references.
- `PLAN.md` — v2.0.0 status header replaces v1.2.0 header at the top.
- `CHANGELOG.md` — new v2.0.0 section explaining: breaking rename, no other changes, migration is `s/@kybernesis\/arcana-/@kybernesis\/cortex-/g` + `createArcana` → `createCortex`. Cite ADR 014.
- `docs/SYSTEM-HEALTH.md` — replace all "Arcana" project-name references with "Cortex". Layer-test references that name source files keep their actual paths (now under `packages/cortex-*/`).
- **New**: `docs/decisions/014-library-rename-arcana-to-cortex.md` — full ADR documenting the why (Ian's cloud product conflict), the what (npm scope + factory + types), and the migration path.
- `docs/decisions/README.md` — index ADR 014.

### E. Docs — historical surface (frozen, do not touch)
- All `[SHIPPED]` sprint plans in `docs/plans/2026-05-2[0-3]-*.md`.
- ADRs 001-013 (point-in-time records).
- Session checkpoints in `docs/reviews/`.
- Audits in `docs/audits/`.

### F. Mochaccino refresh
- `.mochaccino/data/02-package-graph.json` — package names.
- `.mochaccino/data/03-publish-pipeline.json` — package names, v2.0.0 lane, milestone bumped.
- `.mochaccino/data/06-kernel-methods.json` — package names, test count, v2.0.0 sprint note.
- `.mochaccino/views/index.html` — tagline + stats.
- `.mochaccino/views/package-graph.html` — package names.
- `.mochaccino/views/publish-pipeline.html` — chips + lanes.
- `.mochaccino/views/kernel-methods.html` — tagline.

### G. Comms
- Append `ARCANA → KBOT` (yes, this comms file keeps its name since it's a per-project file) entry dated 2026-05-23 announcing v2.0.0 cortex packages staged. Note: comms file at `~/dev/kybernesis/.comms/arcana-kyberbot.md` keeps its name to preserve continuity; consider renaming to `cortex-kyberbot.md` in a follow-up if desired.

## 4. Out of Scope

User-driven, must happen separately:
- **GitHub repo rename** `klueless-io/arcana` → `klueless-io/cortex` (David does in GitHub settings).
- **Local directory rename** `~/dev/kybernesis/arcana` → `~/dev/kybernesis/cortex` (David does after this sprint ships; needs syncthing pause + rename + resume; or rename on both machines).
- **`git remote set-url`** after the GitHub rename.
- **npm publish of all 6 `@kybernesis/cortex-*` packages at v2.0.0** (David runs OTP).
- **KyberBot dep bump** on their `arcana-adoption` branch (KyberBot side).
- **Brain doc rename** `~/dev/ad/brains/kybernesis/arcana-spec.md` → `cortex-spec.md` if desired (lives outside this repo).
- **Comms file rename** if desired (separate decision; keep as-is for now to preserve history).

## 5. Definition of Done

`bun run build` exits 0. `bun run test` exits 0 with ≥ 352 tests (no test additions in this sprint; rename only). All 6 packages at v2.0.0 with new names. CHANGELOG v2.0.0 section. New ADR 014. Mochaccino refreshed. Comms entry appended. Two commits + tag `v2.0.0` pushed to `origin/main`. npm publish NOT executed. Repo rename NOT executed (David's manual step).

## 6. Acceptance Criteria

| # | Criterion | How to check |
|---|---|---|
| 1 | 6 package dirs renamed from `packages/arcana-*` to `packages/cortex-*` | `ls packages/` |
| 2 | 6 `package.json` files have `name: "@kybernesis/cortex-*"` | grep names |
| 3 | All workspace deps in package.json files reference `@kybernesis/cortex-*` | grep deps |
| 4 | Zero `@kybernesis/arcana-` imports remain in source files | `grep -r "@kybernesis/arcana-" packages/ --include="*.ts"` returns nothing |
| 5 | `createCortex()` exported from cortex-core; `createArcana` no longer exported | TS compile + grep |
| 6 | Types `Cortex`, `CortexOptions`, `CortexApi` exported; `Arcana*` no longer exported | TS compile + grep |
| 7 | Logger debug strings use `cortex.X` prefix throughout source | grep `'arcana\.` returns nothing in source |
| 8 | tsconfig project references updated to `packages/cortex-*` | grep references |
| 9 | `bun install` succeeds after rename (lock regenerates cleanly) | exit code |
| 10 | `bun run build` exits 0 | exit code |
| 11 | `bun run test` exits 0 with ≥ 352 tests (no regressions) | exit code + count |
| 12 | All 6 packages at v2.0.0 | grep versions |
| 13 | CHANGELOG v2.0.0 section explains the rename + migration recipe + cites ADR 014 | grep |
| 14 | New ADR 014 exists at `docs/decisions/014-library-rename-arcana-to-cortex.md` | ls + grep |
| 15 | `docs/decisions/README.md` indexes ADR 014 | grep |
| 16 | README, SPEC, PLAN, SYSTEM-HEALTH — all active references to "Arcana" project name → "Cortex" | grep |
| 17 | Mochaccino data/views refreshed — package names + v2.0.0 + test count | inspect |
| 18 | Comms entry dated 2026-05-23 appended noting v2.0.0 cortex packages staged + KyberBot migration recipe | tail comms |
| 19 | Two commits on main — feat (the rename) + chore (v2.0.0 bumps) | `git log --oneline -2` |
| 20 | Tag `v2.0.0` created and pushed | `git ls-remote --tags origin v2.0.0` |
| 21 | Findings appendix populated with any surprises encountered | inspect |

## 7. Findings appendix

### F1 — Prerequisite partially met when goal fired

The plan states v1.2.1 must be live on npm AND KyberBot must have confirmed near-1.0 meanOverlap on a post-v1.2.1 harness re-run. At fire time: v1.2.1 was live (`npm view @kybernesis/arcana-contracts@1.2.1` returned `1.2.1`); KyberBot's post-v1.2.1 re-run had not posted yet (their 09:45 entry was pre-publish, showed 0.769 with Pattern 1 fix only). David fired the goal anyway — the rename can be code-validated independently of parity (it's pure relabeling, no algorithm change). Proceeded; no fallout.

### F2 — BSD sed `\b` word-boundary doesn't work on macOS

First-pass `sed 's/\bArcana\b/Cortex/g'` left 31 matches in source. macOS BSD sed has no `\b` support. Switched to unconditional `s/Arcana/Cortex/g` after verifying no `ArcanaX`-composites remained (createArcana/Options/Api/etc. were already separately renamed first). Same lesson for the lowercase variable name — `\barcana\b` no-op, used plain `s/arcana/cortex/g` after confirming the namespace-prefixed `@kybernesis/arcana-` was already gone.

### F3 — Bun workspace symlinks went stale across the rename

After `git mv` of 6 package dirs + `bun install`, the build failed with `Cannot find module '@kybernesis/cortex-contracts'` everywhere. `node_modules/@kybernesis/` was missing entirely; per-package `node_modules/@kybernesis/` had a mix of stale `arcana-*` symlinks alongside new `cortex-*`. Fix: `rm -rf node_modules packages/*/node_modules bun.lock` then `bun install`. Lock + workspace links regenerated cleanly.

### F4 — `tsc -b` incremental cache held stale references

Even after the lock regenerated, `bun run build` still complained about unresolved imports. Cause: `*.tsbuildinfo` files cached the old `arcana-*` module resolution. Fix: `find packages -name '*.tsbuildinfo' -delete && rm -rf packages/*/dist`. Clean build green on next run.

### F5 — Three classes of "arcana" references intentionally left in place

The mochaccino + active docs were swept aggressively, but three reference patterns were preserved as accurate-at-time-of-writing:

1. **`~/dev/ad/brains/kybernesis/arcana-spec.md`** — the brain doc lives outside this repo; rename is the user's call.
2. **`klueless-io/arcana`** — GitHub repo URL; rename is a user-driven manual step (out of scope of this sprint).
3. **`~/dev/kybernesis/arcana/`** — local working directory; rename is a user-driven manual step (syncthing-aware).

Historical sprint plans (`docs/plans/2026-05-2[0-3]-*.md` with `[SHIPPED]` headers), old ADRs 001-013, audits, and session-checkpoint reviews were **not touched**. They're frozen point-in-time records; rewriting them would mislead future readers about what was decided when. The CHANGELOG v2.0.0 entry + this ADR 014 are the canonical pointers explaining the rename to anyone landing on those historical references.

### F6 — Heavy mochaccino sweep used protect-replace-restore pattern

Many mochaccino files reference `arcana` in narrative context that's still accurate (e.g., "config defaults from arcana-spec.md §11"). Direct `s/arcana/cortex/g` would corrupt those. Solution: temporarily replace the four protected patterns (`arcana-spec.md`, `klueless-io/arcana`, `kybernesis/arcana`, `arcana-kyberbot.md`) with sentinels, sweep, restore. Three residual occurrences remain across all mochaccino files — all `arcana-spec.md` brain-doc references, which is correct.

### F7 — Logger debug strings: caller-visible breaking change

Switched all `deps.logger.debug('arcana.command.X', ...)` → `'cortex.command.X'`. These show up in consumer log output, so KyberBot's log aggregation / debugging tools may have hardcoded patterns. Worth noting in the migration recipe but not a contract surface — KyberBot has full control over which strings their logger handler matches.
