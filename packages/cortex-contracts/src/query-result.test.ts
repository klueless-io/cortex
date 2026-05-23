import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { queryResultSchema, type QueryResult } from './query-result.js';
import { MemorySchema, type Memory } from './memory.js';

describe('queryResultSchema', () => {
  it('round-trips an envelope with primitive data', () => {
    const schema = queryResultSchema(z.string());
    const sample: QueryResult<string> = {
      data: 'hello',
      generated_at: '2026-05-18T08:00:00.000Z',
      data_age_ms: 1234,
      stale: false,
    };
    expect(schema.parse(sample)).toEqual(sample);
  });

  it('round-trips an envelope wrapping a Memory', () => {
    const schema = queryResultSchema(MemorySchema);
    const sample: QueryResult<Memory> = {
      data: {
        id: 'mem_1',
        title: 'Wrapped memory',
        summary: 'short',
        content: 'long',
        tags: [],
        priority: 0.5,
        tier: 'hot',
        decayScore: 0,
        accessCount: 0,
        isPinned: false,
        contentHash: 'hash',
        createdAt: "2026-05-21T00:00:00.000Z",
        source: 'cli',
        status: 'active',
        isLatest: true,
      },
      generated_at: '2026-05-18T08:00:00.000Z',
      data_age_ms: 0,
      stale: false,
    };
    expect(schema.parse(sample)).toEqual(sample);
  });

  it('rejects an envelope with negative data_age_ms', () => {
    const schema = queryResultSchema(z.string());
    expect(() =>
      schema.parse({
        data: 'x',
        generated_at: '2026-05-18T08:00:00.000Z',
        data_age_ms: -1,
        stale: false,
      }),
    ).toThrow();
  });

  it('rejects an envelope with invalid generated_at', () => {
    const schema = queryResultSchema(z.string());
    expect(() =>
      schema.parse({
        data: 'x',
        generated_at: 'not-a-date',
        data_age_ms: 0,
        stale: false,
      }),
    ).toThrow();
  });

  it('rejects unknown keys (strict mode)', () => {
    const schema = queryResultSchema(z.string());
    expect(() =>
      schema.parse({
        data: 'x',
        generated_at: '2026-05-18T08:00:00.000Z',
        data_age_ms: 0,
        stale: false,
        extraneous: 'bad',
      }),
    ).toThrow();
  });
});
