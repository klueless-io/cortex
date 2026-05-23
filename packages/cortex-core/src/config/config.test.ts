import { describe, it, expect } from 'vitest';
import { ConfigSchema, type Config } from './config.js';

describe('ConfigSchema', () => {
  it('parses an empty object into full defaults', () => {
    const config = ConfigSchema.parse({});
    expect(config).toMatchObject({
      sleep: { intervalMs: 3_600_000 },
      decay: { rate: 0.02, floor: 0.3 },
      retrieval: {
        rrfK: 60,
        graphHops: 2,
        rerankerEnabled: false,
        topK: 50,
      },
      chunking: { size: 300, overlap: 75 },
      tier: {
        hotPriorityThreshold: 0.65,
        hotRecencyDays: 3,
        warmRecencyDays: 21,
      },
      sourceWeights: {
        terminal: 0.95,
        chat: 0.85,
        aiExtraction: 0.6,
        upload: 0.9,
        connector: 0.85,
      },
      logging: { level: 'info' },
    });
  });

  it('accepts partial overrides and fills the rest with defaults', () => {
    const config: Config = ConfigSchema.parse({ decay: { rate: 0.05 } });
    expect(config.decay.rate).toBe(0.05);
    expect(config.decay.floor).toBe(0.3);
    expect(config.logging.level).toBe('info');
  });

  it('rejects an out-of-range decay rate', () => {
    expect(() => ConfigSchema.parse({ decay: { rate: 1.5 } })).toThrow();
  });

  it('rejects an unknown top-level key (strict)', () => {
    expect(() => ConfigSchema.parse({ surprise: 'extra' })).toThrow();
  });

  it('rejects an unknown nested key (strict)', () => {
    expect(() =>
      ConfigSchema.parse({ decay: { rate: 0.02, extra: 'no' } }),
    ).toThrow();
  });

  it('rejects an unknown logging level', () => {
    expect(() =>
      ConfigSchema.parse({ logging: { level: 'verbose' } }),
    ).toThrow();
  });
});
