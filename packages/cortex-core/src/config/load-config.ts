import { readFileSync } from 'node:fs';
import { ConfigSchema, type Config } from './config.js';

/**
 * ⚠ STATUS as of v2.1.5: the loaders below produce a validated, deep-frozen
 * `Config` object — but `createCortex()` does not consume it. The kernel
 * currently reads from independent sources (see config.ts for the breakdown).
 *
 * Use these loaders to validate config files and env vars syntactically.
 * Do not assume the values flow into runtime behaviour yet.
 */

/**
 * Describes how one environment variable maps onto a nested config path.
 */
export interface EnvMapEntry {
  path: string;
  coerce?: 'number' | 'boolean';
}

/**
 * Default mapping of env var → config path. Extensible per-call by passing
 * `envMap` to `loadConfig`. No implicit `process.env` access happens
 * anywhere in this module — callers must pass `env` explicitly.
 */
export const ENV_MAP: Record<string, EnvMapEntry> = {
  CORTEX_SLEEP_INTERVAL_MS: { path: 'sleep.intervalMs', coerce: 'number' },
  CORTEX_DECAY_RATE: { path: 'decay.rate', coerce: 'number' },
  CORTEX_DECAY_FLOOR: { path: 'decay.floor', coerce: 'number' },
  CORTEX_RETRIEVAL_RRF_K: { path: 'retrieval.rrfK', coerce: 'number' },
  CORTEX_RETRIEVAL_GRAPH_HOPS: { path: 'retrieval.graphHops', coerce: 'number' },
  CORTEX_RETRIEVAL_RERANKER_ENABLED: {
    path: 'retrieval.rerankerEnabled',
    coerce: 'boolean',
  },
  CORTEX_RETRIEVAL_TOP_K: { path: 'retrieval.topK', coerce: 'number' },
  CORTEX_CHUNKING_SIZE: { path: 'chunking.size', coerce: 'number' },
  CORTEX_CHUNKING_OVERLAP: { path: 'chunking.overlap', coerce: 'number' },
  CORTEX_TIER_HOT_PRIORITY_THRESHOLD: {
    path: 'tier.hotPriorityThreshold',
    coerce: 'number',
  },
  CORTEX_TIER_HOT_RECENCY_DAYS: {
    path: 'tier.hotRecencyDays',
    coerce: 'number',
  },
  CORTEX_TIER_WARM_RECENCY_DAYS: {
    path: 'tier.warmRecencyDays',
    coerce: 'number',
  },
  CORTEX_LOGGING_LEVEL: { path: 'logging.level' },
};

export interface LoadConfigOptions {
  /**
   * Optional path to a JSON config file. Values from the file override
   * built-in defaults but are overridden by env values.
   */
  filePath?: string;

  /**
   * Optional env source (typically `process.env` in production; a literal
   * object in tests; runtime-specific shape in Workers/Convex). Pass
   * undefined to skip env reading entirely.
   */
  env?: Record<string, string | undefined>;

  /**
   * Optional override for the env-var → config-path mapping. Defaults to
   * the exported ENV_MAP.
   */
  envMap?: Record<string, EnvMapEntry>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function setPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    if (!isPlainObject(cur[p])) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    deepFreeze((obj as Record<string, unknown>)[key]);
  }
  return obj;
}

/**
 * Returns just the built-in default configuration, no file or env applied.
 */
export function getDefaultConfig(): Config {
  return deepFreeze(ConfigSchema.parse({}));
}

/**
 * Reads a JSON file and returns its parsed contents. Throws if the file
 * cannot be read or does not contain a JSON object.
 */
export function loadConfigFromFile(
  filePath: string,
): Record<string, unknown> {
  const raw = readFileSync(filePath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Config file ${filePath} must contain a top-level JSON object`,
    );
  }
  return parsed;
}

/**
 * Extracts config values from an env-like object using the supplied map.
 * Numeric and boolean env values are coerced; coercion failures throw with
 * an explicit message.
 */
export function loadConfigFromEnv(
  env: Record<string, string | undefined>,
  map: Record<string, EnvMapEntry> = ENV_MAP,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(map)) {
    const raw = env[key];
    if (raw === undefined) continue;
    let value: unknown = raw;
    if (spec.coerce === 'number') {
      const num = Number(raw);
      if (Number.isNaN(num)) {
        throw new Error(
          `Env var ${key} must be a number, got: ${JSON.stringify(raw)}`,
        );
      }
      value = num;
    } else if (spec.coerce === 'boolean') {
      if (raw !== 'true' && raw !== 'false') {
        throw new Error(
          `Env var ${key} must be "true" or "false", got: ${JSON.stringify(raw)}`,
        );
      }
      value = raw === 'true';
    }
    setPath(out, spec.path, value);
  }
  return out;
}

/**
 * The main entry point. Composes defaults → file → env, validates the
 * result against ConfigSchema, and returns a deep-frozen Config.
 */
export function loadConfig(opts: LoadConfigOptions = {}): Config {
  let merged: Record<string, unknown> = {};

  if (opts.filePath !== undefined) {
    merged = deepMerge(merged, loadConfigFromFile(opts.filePath));
  }

  if (opts.env !== undefined) {
    const fromEnv = loadConfigFromEnv(opts.env, opts.envMap ?? ENV_MAP);
    merged = deepMerge(merged, fromEnv);
  }

  const validated = ConfigSchema.parse(merged);
  return deepFreeze(validated);
}
