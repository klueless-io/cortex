import { describe, it, expect, beforeEach } from 'vitest';
import {
  createNoopLogger,
  type Fact,
  type Contradiction,
  type Insight,
  type Edge,
  type AgentSelf,
} from '@kybernesis/cortex-contracts';
import { createFakeStructuredStore } from '@kybernesis/cortex-testkit/fakes';
import { createQuery, type QueryApi, type QueryDeps } from './index.js';
import { NotImplementedError } from '../../errors.js';

let deps: QueryDeps;
let api: QueryApi;
let structured: ReturnType<typeof createFakeStructuredStore>;

beforeEach(async () => {
  structured = createFakeStructuredStore();
  await structured.connect();
  deps = { structured, logger: createNoopLogger() };
  api = createQuery(deps);
});

describe('createQuery surface', () => {
  it('returns an object with the documented API surface', () => {
    expect(typeof api.queryFacts).toBe('function');
    expect(typeof api.getNeighbors).toBe('function');
    expect(typeof api.stats).toBe('function');
    expect(typeof api.listContradictions).toBe('function');
    expect(typeof api.listInsights).toBe('function');
    expect(typeof api.readBlock).toBe('function');
    expect(typeof api.getBlockHistory).toBe('function');
  });
});

describe('query.queryFacts', () => {
  const sampleSentenceFact: Fact = {
    id: 'f_1',
    fact: 'David likes coffee',
    entities: ['David'],
    category: 'general',    confidence: 0.8,
    sourceType: 'chat',
    createdAt: '2026-05-18T08:00:00.000Z',
    isLatest: true,
  };

  const sampleTripleFact: Fact = {
    id: 'f_2',
    fact: 'David lives in Sydney',
    entities: ['David'],
    category: 'general',    attribute: 'location',
    value: 'Sydney',
    confidence: 0.9,
    sourceType: 'ai-extraction',
    createdAt: '2026-05-18T08:00:00.000Z',
    isLatest: true,
  };

  beforeEach(async () => {
    await structured.storeFact(sampleSentenceFact);
    await structured.storeFact(sampleTripleFact);
  });

  it('returns all facts for an entity (no attribute filter)', async () => {
    const result = await api.queryFacts('David');
    expect(result.data).toHaveLength(2);
    expect(result.data.map((f) => f.id).sort()).toEqual(['f_1', 'f_2']);
  });

  it('filters by attribute when provided', async () => {
    const result = await api.queryFacts('David', 'location');
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe('f_2');
  });

  it('returns an empty array for unknown entity (still QueryResult shape)', async () => {
    const result = await api.queryFacts('Unknown');
    expect(result.data).toEqual([]);
    expect(typeof result.generated_at).toBe('string');
    expect(result.stale).toBe(false);
  });

  it('wraps results in a fresh QueryResult envelope', async () => {
    const result = await api.queryFacts('David');
    expect(result.generated_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(result.data_age_ms).toBe(0);
    expect(result.stale).toBe(false);
  });

  it('excludes expired facts when asOf is supplied', async () => {
    const expiredFact: Fact = {
      id: 'f_exp',
      fact: 'David used to work at OldCo',
      entities: ['David'],
      category: 'general',      confidence: 0.7,
      sourceType: 'chat',
      createdAt: '2024-01-01T00:00:00.000Z',
      expiresAt: '2025-01-01T00:00:00.000Z',
      isLatest: true,
    };
    await structured.storeFact(expiredFact);

    const asOf = '2026-06-01T00:00:00.000Z';
    const result = await api.queryFacts('David', undefined, asOf);
    const ids = result.data.map((f) => f.id).sort();
    expect(ids).toEqual(['f_1', 'f_2']);
    expect(ids).not.toContain('f_exp');
  });

  it('keeps facts whose expiresAt is in the future relative to asOf', async () => {
    const futureFact: Fact = {
      id: 'f_future',
      fact: 'David has a current contract',
      entities: ['David'],
      category: 'general',      confidence: 0.95,
      sourceType: 'chat',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
      isLatest: true,
    };
    await structured.storeFact(futureFact);

    const asOf = '2026-06-01T00:00:00.000Z';
    const result = await api.queryFacts('David', undefined, asOf);
    expect(result.data.map((f) => f.id)).toContain('f_future');
  });

  it('omitting asOf returns all facts including expired ones (backward compat)', async () => {
    await structured.storeFact({
      id: 'f_expired',
      fact: 'old fact',
      entities: ['David'],
      category: 'general',      confidence: 0.5,
      sourceType: 'chat',
      createdAt: '2024-01-01T00:00:00.000Z',
      expiresAt: '2025-01-01T00:00:00.000Z',
      isLatest: true,
    });
    const result = await api.queryFacts('David');
    expect(result.data.map((f) => f.id).sort()).toEqual(['f_1', 'f_2', 'f_expired']);
  });
});

describe('query.getNeighbors', () => {
  it('returns neighbors of a memory node, wrapped in QueryResult', async () => {
    const edge: Edge = {
      id: 'edge_1',
      from: { type: 'memory', id: 'mem_a' },
      to: { type: 'memory', id: 'mem_b' },
      relation: 'related',
      confidence: 0.9,
      sharedTags: [],
      method: 'manual',
      createdAt: '2026-05-20T00:00:00.000Z',
    };
    await structured.storeEdge(edge);

    const result = await api.getNeighbors({ type: 'memory', id: 'mem_a' });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toEqual({ type: 'memory', id: 'mem_b' });
    expect(result.stale).toBe(false);
    expect(result.data_age_ms).toBe(0);
  });

  it('returns empty array for an isolated node', async () => {
    const result = await api.getNeighbors({ type: 'memory', id: 'mem_alone' });
    expect(result.data).toEqual([]);
  });

  it('wraps in QueryResult envelope', async () => {
    const result = await api.getNeighbors({ type: 'memory', id: 'whatever' });
    expect(result.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.data_age_ms).toBe(0);
    expect(result.stale).toBe(false);
  });
});

describe('query.listContradictions', () => {
  const pending: Contradiction = {
    id: 'c_1',
    factAId: 'f_a',
    factBId: 'f_b',
    status: 'pending',
    createdAt: '2026-05-20T00:00:00.000Z',
  };
  const resolved: Contradiction = {
    id: 'c_2',
    factAId: 'f_c',
    factBId: 'f_d',
    status: 'resolved',
    resolution: 'merged into single fact',
    createdAt: '2026-05-20T00:00:00.000Z',
  };

  beforeEach(async () => {
    await structured.storeContradiction(pending);
    await structured.storeContradiction(resolved);
  });

  it('returns all contradictions when status omitted', async () => {
    const result = await api.listContradictions();
    expect(result.data.map((c) => c.id).sort()).toEqual(['c_1', 'c_2']);
  });

  it('filters by status when supplied', async () => {
    const result = await api.listContradictions('pending');
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe('c_1');
  });

  it('wraps in QueryResult envelope', async () => {
    const result = await api.listContradictions();
    expect(result.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.data_age_ms).toBe(0);
    expect(result.stale).toBe(false);
  });
});

describe('query.listInsights', () => {
  const insightForEnt1: Insight = {
    id: 'i_1',
    entityId: 'ent_1',
    type: 'deduction',
    statement: 'Inferred trait',
    supportingFactIds: ['f_a'],
    confidence: 0.8,
    createdAt: '2026-05-20T00:00:00.000Z',
  };
  const insightForEnt2: Insight = {
    id: 'i_2',
    entityId: 'ent_2',
    type: 'induction',
    statement: 'Pattern noticed',
    supportingFactIds: ['f_b'],
    confidence: 0.7,
    createdAt: '2026-05-20T00:00:00.000Z',
  };

  beforeEach(async () => {
    await structured.storeInsight(insightForEnt1);
    await structured.storeInsight(insightForEnt2);
  });

  it('returns all insights when entityId omitted', async () => {
    const result = await api.listInsights();
    expect(result.data.map((i) => i.id).sort()).toEqual(['i_1', 'i_2']);
  });

  it('filters by entityId when supplied', async () => {
    const result = await api.listInsights('ent_1');
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe('i_1');
  });

  it('wraps in QueryResult envelope', async () => {
    const result = await api.listInsights();
    expect(result.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.data_age_ms).toBe(0);
    expect(result.stale).toBe(false);
  });
});

describe('query.readBlock', () => {
  const self: AgentSelf = {
    memoryBlocks: [
      { label: 'persona', content: 'curious operator', updatedAt: '2026-05-21T00:00:00.000Z' },
      { label: 'objectives', content: 'ship kernel sleep pipeline', updatedAt: '2026-05-21T00:00:00.000Z' },
    ],
    history: [],
  };

  beforeEach(async () => {
    await structured.updateAgentSelf(self);
  });

  it('returns the content of the block with the given label', async () => {
    const result = await api.readBlock('persona');
    expect(result.data).toBe('curious operator');
  });

  it('returns null when the label is unknown', async () => {
    const result = await api.readBlock('does-not-exist');
    expect(result.data).toBeNull();
  });

  it('returns null when no agent-self has been stored', async () => {
    // fresh store (no updateAgentSelf yet)
    const freshStore = createFakeStructuredStore();
    await freshStore.connect();
    const freshApi = createQuery({ structured: freshStore, logger: createNoopLogger() });
    const result = await freshApi.readBlock('persona');
    expect(result.data).toBeNull();
  });

  it('wraps in QueryResult envelope', async () => {
    const result = await api.readBlock('persona');
    expect(result.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.data_age_ms).toBe(0);
    expect(result.stale).toBe(false);
  });
});

describe('query.getBlockHistory', () => {
  const self: AgentSelf = {
    memoryBlocks: [{ label: 'persona', content: 'v2 persona', updatedAt: '2026-05-21T00:00:00.000Z' }],
    history: [
      { label: 'persona', previousContent: 'v0 persona', changedAt: '2026-05-19T00:00:00.000Z', changedBy: 'david' },
      { label: 'persona', previousContent: 'v1 persona', changedAt: '2026-05-20T00:00:00.000Z' },
      { label: 'objectives', previousContent: 'older goal', changedAt: '2026-05-19T00:00:00.000Z' },
    ],
  };

  beforeEach(async () => {
    await structured.updateAgentSelf(self);
  });

  it('returns history filtered to the supplied label', async () => {
    const result = await api.getBlockHistory('persona');
    expect(result.data).toHaveLength(2);
    expect(result.data.every((e) => e.label === 'persona')).toBe(true);
  });

  it('returns empty array when no history exists for the label', async () => {
    const result = await api.getBlockHistory('never-changed');
    expect(result.data).toEqual([]);
  });

  it('returns empty array when no agent-self has been stored', async () => {
    const freshStore = createFakeStructuredStore();
    await freshStore.connect();
    const freshApi = createQuery({ structured: freshStore, logger: createNoopLogger() });
    const result = await freshApi.getBlockHistory('persona');
    expect(result.data).toEqual([]);
  });
});

describe('still-stubbed query methods', () => {
  it('stats throws NotImplementedError', async () => {
    await expect(api.stats()).rejects.toThrow(NotImplementedError);
  });
});
