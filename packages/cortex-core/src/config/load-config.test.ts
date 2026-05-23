import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadConfig,
  loadConfigFromFile,
  loadConfigFromEnv,
  getDefaultConfig,
  ENV_MAP,
} from './load-config.js';

describe('loadConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cortex-config-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns full defaults when called with no options', () => {
    const config = loadConfig();
    expect(config.sleep.intervalMs).toBe(3_600_000);
    expect(config.decay.rate).toBe(0.02);
    expect(config.decay.floor).toBe(0.3);
    expect(config.retrieval.rerankerEnabled).toBe(false);
    expect(config.logging.level).toBe('info');
  });

  it('applies file overrides on top of defaults', () => {
    const filePath = join(tempDir, 'cortex.config.json');
    writeFileSync(
      filePath,
      JSON.stringify({
        decay: { rate: 0.05 },
        logging: { level: 'debug' },
      }),
    );
    const config = loadConfig({ filePath });
    expect(config.decay.rate).toBe(0.05);
    expect(config.decay.floor).toBe(0.3); // default preserved
    expect(config.logging.level).toBe('debug');
  });

  it('applies env overrides on top of defaults', () => {
    const config = loadConfig({
      env: {
        ARCANA_SLEEP_INTERVAL_MS: '600000',
        ARCANA_RETRIEVAL_RERANKER_ENABLED: 'true',
      },
    });
    expect(config.sleep.intervalMs).toBe(600_000);
    expect(config.retrieval.rerankerEnabled).toBe(true);
  });

  it('env overrides win over file', () => {
    const filePath = join(tempDir, 'cortex.config.json');
    writeFileSync(
      filePath,
      JSON.stringify({ sleep: { intervalMs: 120000 } }),
    );
    const config = loadConfig({
      filePath,
      env: { ARCANA_SLEEP_INTERVAL_MS: '60000' },
    });
    expect(config.sleep.intervalMs).toBe(60_000);
  });

  it('returns a deep-frozen object', () => {
    const config = loadConfig();
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.sleep)).toBe(true);
    expect(Object.isFrozen(config.retrieval)).toBe(true);
    expect(() => {
      (config.sleep as { intervalMs: number }).intervalMs = 0;
    }).toThrow();
  });

  it('throws on out-of-range value in file', () => {
    const filePath = join(tempDir, 'cortex.config.json');
    writeFileSync(filePath, JSON.stringify({ decay: { rate: 1.5 } }));
    expect(() => loadConfig({ filePath })).toThrow();
  });

  it('throws on non-numeric value for a numeric env var', () => {
    expect(() =>
      loadConfig({ env: { ARCANA_SLEEP_INTERVAL_MS: 'not-a-number' } }),
    ).toThrow();
  });

  it('throws on non-boolean value for a boolean env var', () => {
    expect(() =>
      loadConfig({ env: { ARCANA_RETRIEVAL_RERANKER_ENABLED: 'maybe' } }),
    ).toThrow();
  });

  it('does NOT implicitly read process.env (env must be passed)', () => {
    // Even if a real ARCANA_* var is set in this process, loadConfig() with
    // no env argument should return defaults.
    process.env.ARCANA_SLEEP_INTERVAL_MS = '999';
    try {
      const config = loadConfig();
      expect(config.sleep.intervalMs).toBe(3_600_000);
    } finally {
      delete process.env.ARCANA_SLEEP_INTERVAL_MS;
    }
  });
});

describe('getDefaultConfig', () => {
  it('returns the same shape as loadConfig() with no options', () => {
    expect(getDefaultConfig()).toEqual(loadConfig());
  });

  it('returns a deep-frozen object', () => {
    const config = getDefaultConfig();
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.sleep)).toBe(true);
  });
});

describe('loadConfigFromEnv', () => {
  it('returns empty object for empty env', () => {
    expect(loadConfigFromEnv({})).toEqual({});
  });

  it('skips undefined values', () => {
    expect(loadConfigFromEnv({ ARCANA_SLEEP_INTERVAL_MS: undefined })).toEqual(
      {},
    );
  });

  it('coerces numbers correctly', () => {
    expect(loadConfigFromEnv({ ARCANA_DECAY_RATE: '0.05' })).toEqual({
      decay: { rate: 0.05 },
    });
  });

  it('coerces booleans correctly', () => {
    expect(
      loadConfigFromEnv({ ARCANA_RETRIEVAL_RERANKER_ENABLED: 'false' }),
    ).toEqual({ retrieval: { rerankerEnabled: false } });
  });

  it('leaves string values uncoerced', () => {
    expect(loadConfigFromEnv({ ARCANA_LOGGING_LEVEL: 'debug' })).toEqual({
      logging: { level: 'debug' },
    });
  });

  it('supports a custom env map', () => {
    const customMap = {
      MY_VAR: { path: 'custom.nested.thing', coerce: 'number' as const },
    };
    expect(loadConfigFromEnv({ MY_VAR: '42' }, customMap)).toEqual({
      custom: { nested: { thing: 42 } },
    });
  });
});

describe('loadConfigFromFile', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cortex-config-file-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads a valid JSON file', () => {
    const filePath = join(tempDir, 'cortex.config.json');
    writeFileSync(filePath, JSON.stringify({ sleep: { intervalMs: 60000 } }));
    expect(loadConfigFromFile(filePath)).toEqual({
      sleep: { intervalMs: 60000 },
    });
  });

  it('throws on non-object JSON', () => {
    const filePath = join(tempDir, 'cortex.config.json');
    writeFileSync(filePath, JSON.stringify('a string'));
    expect(() => loadConfigFromFile(filePath)).toThrow();
  });

  it('throws on missing file', () => {
    expect(() => loadConfigFromFile(join(tempDir, 'nope.json'))).toThrow();
  });
});

describe('ENV_MAP', () => {
  it('exports a non-empty map', () => {
    expect(Object.keys(ENV_MAP).length).toBeGreaterThan(0);
  });

  it('every entry has a path', () => {
    for (const spec of Object.values(ENV_MAP)) {
      expect(spec.path).toBeTruthy();
    }
  });
});
