import { describe, it, expect } from 'vitest';
import { EdgeSchema, NodeRefSchema, type Edge } from './edge.js';

describe('NodeRefSchema', () => {
  it('accepts a memory reference', () => {
    expect(NodeRefSchema.parse({ type: 'memory', id: 'mem_1' })).toEqual({
      type: 'memory',
      id: 'mem_1',
    });
  });

  it('accepts an entity reference', () => {
    expect(NodeRefSchema.parse({ type: 'entity', id: 'ent_1' })).toEqual({
      type: 'entity',
      id: 'ent_1',
    });
  });

  it('rejects an unknown discriminator', () => {
    expect(() => NodeRefSchema.parse({ type: 'chunk', id: 'chk_1' })).toThrow();
  });
});

describe('EdgeSchema', () => {
  it('round-trips a valid Edge', () => {
    const sample: Edge = {
      id: 'edge_1',
      from: { type: 'memory', id: 'mem_1' },
      to: { type: 'entity', id: 'ent_1' },
      relation: 'mentions',
      confidence: 0.85,
      sharedTags: ['anthropic', 'company'],
      rationale: 'Memory text refers to entity',
      method: 'jaccard',
      createdAt: '2026-05-18T08:00:00.000Z',
    };
    expect(EdgeSchema.parse(sample)).toEqual(sample);
  });
});
