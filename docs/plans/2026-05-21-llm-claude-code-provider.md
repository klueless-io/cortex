# Plan — `arcana-provider-llm-claude-code` package (v0.5.0)

**Date**: 2026-05-21
**Mode**: code
**Driving session**: arcana-library (post-/compact handover)
**Related**:
- [ADR 012](../decisions/012-llm-provider-architecture.md) — LLM provider architecture (this package is the v1 subprocess-transport implementation)
- [ADR 011](../decisions/011-port-first-improve-later.md) — port-first principle (this package is a clean port from KyberBot)
- KyberBot source of truth: `/Users/davidcruwys/dev/kybernesis/kyberbot/packages/cli/src/claude.ts`

## 1. Stack

- Arcana monorepo at `/Users/davidcruwys/dev/kybernesis/arcana`
- All 5 packages currently at v0.4.1 (live on npm since 2026-05-21)
- KyberBot reference at `/Users/davidcruwys/dev/kybernesis/kyberbot/packages/cli/src/claude.ts` (the *empirical* implementation; source of truth for behaviour)
- Bun 1.3.10 / Vitest 4.1 / TypeScript 5.9 strict / ESLint 10
- This sprint bumps to v0.5.0 (minor — new public API package; pure additive surface)

## 2. In Scope

### New package: `@kybernesis/arcana-provider-llm-claude-code`

A new workspace package implementing `LLMProvider` (from `arcana-contracts`) via subprocess invocation of the Claude Code CLI (`claude -p`). Mirrors KyberBot's `claude.ts → completeSubprocess` path faithfully.

**Files to create:**
- `packages/arcana-provider-llm-claude-code/package.json`
- `packages/arcana-provider-llm-claude-code/tsconfig.json`
- `packages/arcana-provider-llm-claude-code/README.md`
- `packages/arcana-provider-llm-claude-code/src/index.ts` — `createClaudeCodeLLMProvider(opts)` factory
- `packages/arcana-provider-llm-claude-code/src/index.test.ts` — tests with mocked subprocess

**Package.json shape (mirror existing provider packages):**
```json
{
  "name": "@kybernesis/arcana-provider-llm-claude-code",
  "version": "0.5.0",
  "description": "LLM provider for Arcana — subprocess-based Claude Code CLI wrapper (no API key)",
  "license": "MIT",
  "author": "David Cruwys (AppyDave)",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc -b",
    "clean": "tsc -b --clean",
    "typecheck": "tsc -b"
  },
  "dependencies": {
    "@kybernesis/arcana-contracts": "workspace:*"
  },
  "publishConfig": { "access": "public" }
}
```

### Implementation — `createClaudeCodeLLMProvider(opts)` factory

Mirrors KyberBot's `claude.ts → completeSubprocess` (lines ~150-300+, the subprocess invocation path). The exposed surface conforms to `LLMProvider` from `arcana-contracts`:

```ts
import type { LLMProvider, LLMCompleteOpts } from '@kybernesis/arcana-contracts';

export interface ClaudeCodeProviderOptions {
  /** Binary to spawn. Defaults to 'claude'. */
  binary?: string;
  /** Model shorthand. Defaults to 'haiku'. */
  defaultModel?: 'haiku' | 'sonnet' | 'opus';
  /** Working directory to spawn the subprocess in. */
  cwd?: string;
  /** Optional logger (defaults to noop). */
  logger?: { debug: (msg: string, ctx?: unknown) => void };
}

export function createClaudeCodeLLMProvider(
  opts?: ClaudeCodeProviderOptions,
): LLMProvider;
```

**Behavioural details to port from KyberBot (`claude.ts`):**

- Model ID mapping: `{ haiku: 'claude-haiku-4-5', sonnet: 'claude-sonnet-4-6', opus: 'claude-opus-4-7' }` (KB line 64-68).
- Subprocess invocation: `spawn(binary, ['-p', prompt, '--model', modelId, ...])`. Read stdout. Pipe prompt to stdin or pass as argv per KB's actual pattern (read the file to confirm).
- `maxTokens` / `system` / `cwd` options pass through.
- Sensible error handling on non-zero exit, missing binary, etc.

**NOT in scope for this sprint:**
- The Agent SDK / `query()` in-process mode (KB has it but defaults to subprocess for memory isolation; we don't need it on day 1).
- The SDK / direct-Anthropic-API mode (that's `arcana-provider-llm-http`, separate package per ADR 012).
- `subprocess: true` opt-in (in KB it's a per-call flag; in Arcana this *is* the subprocess provider, so it's always-on).
- `loopDetection` field — KB has it for stream-json mode; defer until streaming is added.
- `onChunk` streaming — defer to a future v2 evolution.

### Tests

`packages/arcana-provider-llm-claude-code/src/index.test.ts` uses `vi.mock('node:child_process')` to stub `spawn`. Coverage:

- **Happy path** — spawning `claude -p` returns stdout content; provider returns it.
- **Model mapping** — `model: 'haiku'` resolves to `claude-haiku-4-5` in the spawn argv.
- **Default model** — when `defaultModel: 'sonnet'` and no per-call model is supplied, sonnet is used.
- **`cwd` honored** — provider-level `cwd` passes through to spawn options.
- **`maxTokens` passes through** if KB's invocation pattern uses an argv flag for it.
- **`system` prompt** included in invocation per KB's pattern.
- **Subprocess error** — non-zero exit code throws with a clear message.
- **Missing binary** — `ENOENT` from spawn is caught and surfaced as an `LLMProvider` error.

### Workspace integration

- Root `package.json` `workspaces` already covers `packages/*` — no edit needed.
- Root `tsconfig.json` adds a project reference to the new package.
- `bun.lock` regenerates automatically on next `bun install`.

### Documentation

- New package's README with usage example (consumer wiring `createClaudeCodeLLMProvider()` into `createArcana({ llm: ... })`).
- CHANGELOG.md v0.5.0 entry: names the new package, references ADRs 011 + 012, notes the `claude -p` deprecation horizon (mid-2026; internals will migrate when that lands; contract stays stable).

### Mochaccino refresh

- `02-package-graph.json` — add the new package node with its single dep on `arcana-contracts`.
- `04-contracts-surface.json` — note that `LLMProvider` now has a concrete impl shipping.
- `06-kernel-methods.json` — bump test count + add a `concrete_providers` note for LLM.
- `03-publish-pipeline.json` — `package_count` bumped from 5 → 6; new package added to `packages_to_publish` array; v0.5.0 lane added.
- View regeneration: `index.html` (test count + tagline + done-strip), `kernel-methods.html` (test count + tagline), `package-graph.html` (new node + v0.5.0 tagline + 6-package count), `publish-pipeline.html` (new pkg chip + v0.5.0 lane).

### Comms entry

Append to `~/dev/kybernesis/.comms/arcana-kyberbot.md`. Tells KyberBot:
- v0.5.0 ships `@kybernesis/arcana-provider-llm-claude-code` — the subprocess LLM provider, faithful port of `claude.ts → completeSubprocess`.
- Implements `LLMProvider` from `arcana-contracts`. No API key needed. Spawns `claude -p`.
- Default action for KyberBot: optional. The provider is available if KyberBot wants to drop its local `claude.ts` and consume Arcana's wrapper instead. Per ADR 011's parity discipline, parity expectation for that swap is 100%.
- Bounce-back via QUESTION if: deprecation of `claude -p` requires earlier-than-expected internals migration; any TS surface issue consuming `LLMProvider`; loopDetection or streaming becomes blocking.

### Ship sequence

- Two commits on `main`: `feat` (new package + tests + docs + mochaccino + comms + workspace integration) then `chore` (version bumps across all 6 packages, since the new package starts at 0.5.0 and existing ones bump from 0.4.1 → 0.5.0 to align)
- `git tag v0.5.0`
- `git push origin main && git push origin v0.5.0`
- STOP before npm publish (OTP — hand back to David)

## 3. Out of Scope

- **`arcana-provider-llm-http`** — separate sprint per ADR 012. Greenfield with retroactive port discipline.
- **Agent SDK in-process mode** — disabled in KyberBot for memory-leak reasons; not needed in this v1 provider.
- **Streaming (`onChunk`, stream-json mode)** — KB has it; deferred to v2 evolution of this provider.
- **`loopDetection`** — KB has it for stream-json mode; deferred with streaming.
- **Reranker utility wiring** — ADR 012 says reranker is a kernel utility on top of `LLMProvider`; that utility isn't built in this sprint. Sleep pipeline sprint will build it.
- **Sleep pipeline implementation** — depends on this provider; separate (multi-)sprint.
- **v2 factRetrieval** (rich-bundle return) — separate consumer-demand-driven sprint.
- **`arcana-provider-postgres`** — Brain migration gate; consumer-driven.
- **npm publish** — OTP flow; David runs it.
- **KyberBot or Brain repo changes** — none.

## 4. Definition of Done

`git log --oneline -2` shows `feat` package commit + `chore` version-bump commit, both pushed to `origin/main`. `git tag` lists `v0.5.0` (pushed). `bun run build` exits 0. `bun run test` exits 0 with ≥ 270 tests (262 baseline + new provider tests). New package directory exists at `packages/arcana-provider-llm-claude-code/`. All 6 packages bumped to 0.5.0. CHANGELOG.md has v0.5.0 section. Mochaccino reflects 6-package state + v0.5.0 lane. Comms entry appended. npm publish NOT executed.

## 5. Acceptance Criteria

| # | Criterion | How to check |
|---|---|---|
| 1 | Package directory exists with package.json, tsconfig.json, README.md, src/index.ts, src/index.test.ts | `ls packages/arcana-provider-llm-claude-code/` |
| 2 | `createClaudeCodeLLMProvider(opts?)` factory exported; returns an `LLMProvider`-conforming object | TS compile check + test |
| 3 | Subprocess invocation uses `claude -p` (or KB's verified pattern from `kyberbot/packages/cli/src/claude.ts`) | Inspect `src/index.ts`; KB file:line cited in code comment |
| 4 | Model shorthand mapping matches KB: `haiku → claude-haiku-4-5`, `sonnet → claude-sonnet-4-6`, `opus → claude-opus-4-7` | Test asserts mapped values |
| 5 | Default model = `haiku` when neither factory-level nor per-call model is supplied | Test |
| 6 | `cwd` factory option + `system` per-call option both honored | Tests |
| 7 | Subprocess errors (non-zero exit, ENOENT) surfaced clearly | Tests with mocked spawn failure paths |
| 8 | `vi.mock('node:child_process')` used so tests don't actually spawn `claude` | Inspect test file; subprocess never really invoked |
| 9 | Tests pass — at least 8 tests for this package | Vitest exit 0 |
| 10 | All 6 packages (5 existing + 1 new) at v0.5.0 | `grep -h '"version"' packages/*/package.json` reports `0.5.0` |
| 11 | `bun run build` exits 0 across the workspace | Exit code 0 |
| 12 | `bun run test` exits 0 with ≥ 270 tests | Exit code 0; count check |
| 13 | CHANGELOG.md has v0.5.0 section referencing ADR 011 + ADR 012 | `grep -A 3 "v0.5.0" CHANGELOG.md` |
| 14 | Mochaccino reflects 6-package state | `02-package-graph.json` has 6 nodes; `03-publish-pipeline.json` lists 6 packages |
| 15 | Comms entry appended dated 2026-05-21 | `tail ~/dev/kybernesis/.comms/arcana-kyberbot.md` shows ARCANA → KBOT v0.5.0 entry |
| 16 | Tag pushed | `git ls-remote --tags origin v0.5.0` returns the tag |
| 17 | npm publish NOT executed | `npm view @kybernesis/arcana-provider-llm-claude-code@0.5.0 version` returns 404 |
| 18 | Two commits on main: feat + chore | `git log --oneline -2` shows both |
| 19 | Findings appendix populated with concrete port-time resolutions | Appendix updated, not placeholders |

## 6. Key References

- This plan: `/Users/davidcruwys/dev/kybernesis/arcana/docs/plans/2026-05-21-llm-claude-code-provider.md`
- KyberBot source of truth (READ THIS FIRST): `/Users/davidcruwys/dev/kybernesis/kyberbot/packages/cli/src/claude.ts`
- ADR 012 (architecture): `/Users/davidcruwys/dev/kybernesis/arcana/docs/decisions/012-llm-provider-architecture.md`
- ADR 011 (port-first): `/Users/davidcruwys/dev/kybernesis/arcana/docs/decisions/011-port-first-improve-later.md`
- LLMProvider contract: `/Users/davidcruwys/dev/kybernesis/arcana/packages/arcana-contracts/src/providers.ts`
- Existing provider package shape (mirror this): `/Users/davidcruwys/dev/kybernesis/arcana/packages/arcana-provider-libsql/`
- Comms log: `/Users/davidcruwys/dev/kybernesis/.comms/arcana-kyberbot.md`
- Session checkpoint: `/Users/davidcruwys/dev/kybernesis/arcana/docs/reviews/session-checkpoint-2026-05-21.md`

## Findings appendix

_Populated by the goal-runner during the port. Likely judgment-call areas:_

- **Subprocess invocation pattern** — does KB pass prompt via argv (`claude -p "..."`) or via stdin (`echo "..." | claude -p`)? Determines argv shape and pipe wiring.
- **Model-flag syntax** — `--model claude-haiku-4-5` vs `--model haiku` vs no flag (subscription default). Read KB's actual subprocess construction.
- **`maxTokens` plumbing** — does KB pass it via argv flag, env var, or not at all in subprocess mode?
- **System prompt mechanism** — argv flag, stdin prefix, or skipped in subprocess?
- **`cwd` resolution** — KB uses CWD for fleet-mode project attribution. Confirm Arcana's exposure matches.
- **Error surface** — does KB throw, return null, or log on subprocess failure? Match its pattern.
- **`-p` deprecation horizon note** — confirm the deprecation note (mid-2026) is recorded in the README + CHANGELOG so future-us knows the internals will migrate when CC's replacement invocation lands.

Each resolution cites KyberBot file:line and the Arcana code location.
