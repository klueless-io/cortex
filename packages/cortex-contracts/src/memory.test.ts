import { describe, it, expect } from 'vitest';
import {
  MemorySchema,
  ChunkSchema,
  type Memory,
  type Chunk,
} from './memory.js';

const sampleMemory: Memory = {
  id: 'mem_1',
  title: 'Test memory',
  summary: 'A short summary.',
  content: 'The full content body.',
  tags: ['test', 'sample'],
  priority: 0.5,
  tier: 'warm',
  decayScore: 0.1,
  accessCount: 3,
  lastAccessedAt: '2026-05-18T08:00:00.000Z',
  isPinned: false,
  contentHash: 'abc123',
  createdAt: "2026-05-21T00:00:00.000Z",
  source: 'cli',
  status: 'active',
  isLatest: true,
  scopes: { org_id: 'org_1' },
};

describe('MemorySchema', () => {
  it('round-trips a valid Memory', () => {
    expect(MemorySchema.parse(sampleMemory)).toEqual(sampleMemory);
  });

  it('rejects an invalid priority (out of range)', () => {
    expect(() =>
      MemorySchema.parse({ ...sampleMemory, priority: 1.5 }),
    ).toThrow();
  });

  it('rejects an unknown tier', () => {
    expect(() =>
      MemorySchema.parse({ ...sampleMemory, tier: 'frozen' }),
    ).toThrow();
  });

  it('accepts each MemoryStatus value', () => {
    for (const status of ['active', 'archived', 'deleted'] as const) {
      expect(MemorySchema.parse({ ...sampleMemory, status }).status).toBe(status);
    }
  });

  it('rejects an unknown status', () => {
    expect(() =>
      MemorySchema.parse({ ...sampleMemory, status: 'pending' }),
    ).toThrow();
  });

  it('rejects a memory missing status', () => {
    const { status: _drop, ...withoutStatus } = sampleMemory;
    expect(() => MemorySchema.parse(withoutStatus)).toThrow();
  });

  it('rejects a memory missing isLatest', () => {
    const { isLatest: _drop, ...withoutIsLatest } = sampleMemory;
    expect(() => MemorySchema.parse(withoutIsLatest)).toThrow();
  });

  it('accepts supersededBy when set', () => {
    const superseded: Memory = { ...sampleMemory, isLatest: false, supersededBy: 'mem_2' };
    expect(MemorySchema.parse(superseded)).toEqual(superseded);
  });

  it('rejects an empty supersededBy string', () => {
    expect(() =>
      MemorySchema.parse({ ...sampleMemory, isLatest: false, supersededBy: '' }),
    ).toThrow();
  });
});

describe('ChunkSchema', () => {
  it('round-trips a valid Chunk', () => {
    const sample: Chunk = {
      id: 'chk_1',
      memoryId: 'mem_1',
      text: 'A chunk of text.',
      vectorId: 'vec_1',
      layer: 'hot',
    };
    expect(ChunkSchema.parse(sample)).toEqual(sample);
  });

  it('allows omitting vectorId', () => {
    const sample: Chunk = {
      id: 'chk_2',
      memoryId: 'mem_1',
      text: 'No vector yet.',
      layer: 'warm',
    };
    expect(ChunkSchema.parse(sample)).toEqual(sample);
  });
});
