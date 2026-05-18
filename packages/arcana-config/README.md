# @kybernesisai/arcana-config

Zod-validated configuration loader for the Arcana kernel.

## Layering

Three layers, in precedence order (later wins):

1. **Built-in defaults** — locked-in decisions from `arcana-spec.md` (decay rate 2%/wk floor 0.30, RRF k=60, etc.)
2. **Optional config file** — JSON file passed via `filePath`
3. **Environment variables** — explicit map (`ENV_MAP`) — no implicit `process.env` access. Caller must pass `env` explicitly.

## Usage

```ts
import { loadConfig } from '@kybernesisai/arcana-config';

// Defaults only
const defaults = loadConfig();

// File only
const fromFile = loadConfig({ filePath: './arcana.config.json' });

// Env only (caller-supplied; no implicit process.env read)
const fromEnv = loadConfig({ env: process.env });

// All three layered
const config = loadConfig({
  filePath: './arcana.config.json',
  env: process.env,
});
```

The returned config is **deep-frozen** — any attempt to mutate it throws at runtime.

## Why no implicit `process.env`?

A config loader that quietly reads `process.env` is a hidden coupling that bites you in tests, in Convex workers, and in Cloudflare Workers (where `process.env` is differently shaped). Requiring `env` to be passed explicitly forces the caller to make the source visible. Tests pass a literal object; production passes `process.env`; alternate runtimes pass whatever they have.

## License

MIT
