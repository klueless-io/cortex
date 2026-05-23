# @kybernesis/arcana-provider-llm-claude-code

Subprocess-based `LLMProvider` for [Arcana](https://github.com/kybernesis/arcana). Wraps the Claude Code CLI (`claude -p`) — no API key required, uses your local Claude Code subscription.

Faithful port of KyberBot's `claude.ts → completeSubprocess` path. Per [ADR 011](../../docs/decisions/011-port-first-improve-later.md) (port-first) and [ADR 012](../../docs/decisions/012-llm-provider-architecture.md) (LLM provider architecture).

## Install

```sh
npm install @kybernesis/arcana-provider-llm-claude-code
```

You also need the Claude Code CLI installed and logged in (`claude` on PATH).

## Usage

```ts
import { createArcana } from '@kybernesis/arcana-core';
import { createClaudeCodeLLMProvider } from '@kybernesis/arcana-provider-llm-claude-code';

const arcana = createArcana({
  // ...other providers
  llm: createClaudeCodeLLMProvider({
    defaultModel: 'haiku', // 'haiku' | 'sonnet' | 'opus'
  }),
});
```

## Options

| Option | Type | Default | Notes |
|---|---|---|---|
| `binary` | `string` | `'claude'` | Path to the Claude Code binary |
| `defaultModel` | `'haiku' \| 'sonnet' \| 'opus'` | `'haiku'` | Resolved to `claude-haiku-4-5` / `claude-sonnet-4-6` / `claude-opus-4-7` |
| `cwd` | `string` | inherited | Working directory for the spawned subprocess. In fleet scenarios, pass the agent's root so Claude Code attributes session files correctly |
| `logger` | `{ debug }` | noop | Optional debug logger |

## What's NOT supported (yet)

- `opts.temperature` — `claude -p` has no temperature flag. Use `arcana-provider-llm-http` for temperature control.
- Streaming (`onChunk`) — deferred to a future v2 evolution.
- Loop detection — deferred with streaming.
- In-process Agent SDK mode — KyberBot disabled it for memory-leak reasons; not needed here.

## Sunset note

The `claude -p` invocation pattern is scheduled for deprecation around mid-2026. When the replacement invocation lands, **this package's internals migrate** — the public `LLMProvider` contract stays stable, so consumers do not change. Track the deprecation via the Anthropic / Claude Code release notes.

## References

- KyberBot source of truth: `kyberbot/packages/cli/src/claude.ts`
- [ADR 011 — port-first, improve-later](../../docs/decisions/011-port-first-improve-later.md)
- [ADR 012 — LLM provider architecture](../../docs/decisions/012-llm-provider-architecture.md)
- `LLMProvider` contract: `@kybernesis/arcana-contracts`
