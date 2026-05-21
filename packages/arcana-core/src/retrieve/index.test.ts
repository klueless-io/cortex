import { describe, it, expect, beforeEach } from 'vitest';
import {
  createNoopLogger,
  type VectorStore,
  type EmbeddingProvider,
  type RerankerProvider,
  type Memory,
} from '@kybernesis/arcana-contracts';
import { createFakeStructuredStore } from '@kybernesis/arcana-testkit/fakes';
import { createRetrieve, type RetrieveDeps } from './index.js';

let structured: ReturnType<typeof createFakeStructuredStore>;
let deps: RetrieveDeps;

beforeEach(async () => {
  structured = createFakeStructuredStore();
  await structured.connect();
  deps = {
    structured,
    vector: {} as any,
    embed: {} as any,
    logger: createNoopLogger(),
  };
});

// ---------------------------------------------------------------------------
// getEntityProfile
// ---------------------------------------------------------------------------

describe('getEntityProfile', () => {
  it('returns null when entity has no facts', async () => {
    const api = createRetrieve(deps);
    const result = await api.getEntityProfile('ent_unknown');
    expect(result.data).toBeNull();
  });

  it('assembles profile from facts', async () => {
    await structured.storeFact({
      id: 'fact_1',
      fact: 'Alice works at Anthropic',
      entity: 'ent_1',
      confidence: 0.9,
      sourceType: 'chat',
      createdAt: new Date().toISOString(),
      isLatest: true,
    });
    await structured.storeFact({
      id: 'fact_2',
      fact: 'Alice lives in San Francisco',
      entity: 'ent_1',
      confidence: 0.8,
      sourceType: 'chat',
      createdAt: new Date().toISOString(),
      isLatest: true,
    });

    const api = createRetrieve(deps);
    const result = await api.getEntityProfile('ent_1');

    expect(result.data).not.toBeNull();
    expect(result.data!.staticFacts).toHaveLength(2);
    expect(result.data!.entityId).toBe('ent_1');
  });

  it('returns stored profile on second call', async () => {
    await structured.storeFact({
      id: 'fact_3',
      fact: 'Bob is a developer',
      entity: 'ent_2',
      confidence: 0.95,
      sourceType: 'terminal',
      createdAt: new Date().toISOString(),
      isLatest: true,
    });

    const api = createRetrieve(deps);

    // First call assembles and stores the profile
    const first = await api.getEntityProfile('ent_2');
    expect(first.data).not.toBeNull();

    // Verify it was stored by checking the structured store directly
    const stored = await structured.getEntityProfile('ent_2');
    expect(stored).not.toBeNull();
    expect(stored!.entityId).toBe('ent_2');

    // Second call returns from storage
    const second = await api.getEntityProfile('ent_2');
    expect(second.data).toEqual(stored);
  });

  it('wraps result in QueryResult envelope', async () => {
    await structured.storeFact({
      id: 'fact_4',
      fact: 'Carol leads engineering',
      entity: 'ent_3',
      confidence: 0.85,
      sourceType: 'ai-extraction',
      createdAt: new Date().toISOString(),
      isLatest: true,
    });

    const api = createRetrieve(deps);
    const result = await api.getEntityProfile('ent_3');

    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('generated_at');
    expect(result).toHaveProperty('data_age_ms', 0);
    expect(result).toHaveProperty('stale', false);
    expect(typeof result.generated_at).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// factRetrieval
// ---------------------------------------------------------------------------

describe('factRetrieval', () => {
  it('returns empty array when store is empty', async () => {
    const api = createRetrieve(deps);
    const result = await api.factRetrieval({ query: 'anything' });
    expect(result.data).toEqual([]);
  });

  it('matches memories by query words', async () => {
    await structured.storeMemory({
      id: 'mem_1',
      title: 'Anthropic founding',
      summary: 'History of Anthropic',
      content: 'Anthropic was founded by Dario Amodei',
      tags: [],
      priority: 0.5,
      tier: 'warm',
      decayScore: 0,
      accessCount: 0,
      isPinned: false,
      contentHash: 'abc12345',
      createdAt: "2026-05-21T00:00:00.000Z",
      source: 'cli',
      status: 'active',
      isLatest: true,
    });

    const api = createRetrieve(deps);
    const result = await api.factRetrieval({ query: 'Anthropic founded' });

    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0]!.score).toBeGreaterThan(0);
    expect(result.data[0]!.memory.id).toBe('mem_1');
  });

  it('scores higher for more word matches', async () => {
    await structured.storeMemory({
      id: 'mem_high',
      title: 'Dario Amodei Anthropic',
      summary: 'Founded Anthropic',
      content: 'Dario Amodei founded Anthropic with his sister',
      tags: [],
      priority: 0.5,
      tier: 'warm',
      decayScore: 0,
      accessCount: 0,
      isPinned: false,
      contentHash: 'aaa11111',
      createdAt: "2026-05-21T00:00:00.000Z",
      source: 'cli',
      status: 'active',
      isLatest: true,
    });
    await structured.storeMemory({
      id: 'mem_low',
      title: 'Some company',
      summary: 'Dario is the CEO',
      content: 'Dario runs things here',
      tags: [],
      priority: 0.5,
      tier: 'warm',
      decayScore: 0,
      accessCount: 0,
      isPinned: false,
      contentHash: 'bbb22222',
      createdAt: "2026-05-21T00:00:00.000Z",
      source: 'cli',
      status: 'active',
      isLatest: true,
    });

    const api = createRetrieve(deps);
    // Query words with length > 2: "dario", "anthropic", "founded"
    const result = await api.factRetrieval({ query: 'dario anthropic founded' });

    expect(result.data.length).toBeGreaterThanOrEqual(2);
    // mem_high matches all 3 words, mem_low matches only 1 — mem_high should come first
    expect(result.data[0]!.memory.id).toBe('mem_high');
    expect(result.data[0]!.score).toBeGreaterThan(result.data[1]!.score);
  });

  it('result includes layer-tagged why field per ADR 011 KB-faithful port', async () => {
    await structured.storeMemory({
      id: 'mem_2',
      title: 'Test memory',
      summary: 'About testing',
      content: 'This is a testing document for the structured retrieval path',
      tags: [],
      priority: 0.5,
      tier: 'warm',
      decayScore: 0,
      accessCount: 0,
      isPinned: false,
      contentHash: 'ccc33333',
      createdAt: '2026-05-21T00:00:00.000Z',
      source: 'cli',
      status: 'active',
      isLatest: true,
    });

    const api = createRetrieve(deps);
    const result = await api.factRetrieval({ query: 'testing document' });

    expect(result.data.length).toBeGreaterThan(0);
    // KB-faithful: why is layer-tagged. Layer 1 direct match → 'fact-retrieval/direct'
    expect(result.data[0]!.why).toBe('fact-retrieval/direct');
  });

  it('wraps result in QueryResult envelope', async () => {
    const api = createRetrieve(deps);
    const result = await api.factRetrieval({ query: 'something' });

    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('generated_at');
    expect(result).toHaveProperty('data_age_ms', 0);
    expect(result).toHaveProperty('stale', false);
    expect(typeof result.generated_at).toBe('string');
  });

  it('layer 2 — entity-name match surfaces memories linked to matched entities', async () => {
    // Memory whose CONTENT doesn't match the query, but is linked to an
    // entity whose NAME does match — Layer 2 should find it.
    await structured.storeMemory({
      id: 'mem_linked', title: 'Unrelated title', summary: 'Unrelated', content: 'Unrelated body',
      tags: [], priority: 0.5, tier: 'warm', decayScore: 0, accessCount: 0,
      isPinned: false, contentHash: 'ent1', createdAt: '2026-05-21T00:00:00.000Z',
      source: 'cli', status: 'active', isLatest: true,
    });
    await structured.upsertEntity({
      id: 'ent_kyb', name: 'Kybernesis', type: 'company', mentionCount: 1,
    });
    await structured.storeEdge({
      id: 'edge_l',
      from: { type: 'entity', id: 'ent_kyb' },
      to: { type: 'memory', id: 'mem_linked' },
      relation: 'mentioned-in', confidence: 1.0, sharedTags: [], method: 'manual',
      createdAt: '2026-05-21T00:00:00.000Z',
    });

    const api = createRetrieve(deps);
    const result = await api.factRetrieval({ query: 'kybernesis' });
    const linked = result.data.find((r) => r.memory.id === 'mem_linked');
    expect(linked).toBeDefined();
    expect(linked?.why).toBe('fact-retrieval/entity_expansion');
  });

  it('layer 3 — graph expansion reaches memories one hop from seed entities', async () => {
    // Seed entity name matches query; a NEIGHBOR entity (one hop away)
    // has its own linked memory — Layer 3 surfaces that memory.
    await structured.storeMemory({
      id: 'mem_hop1', title: 'Hop-one memory', summary: '', content: 'Reached via graph',
      tags: [], priority: 0.5, tier: 'warm', decayScore: 0, accessCount: 0,
      isPinned: false, contentHash: 'h1', createdAt: '2026-05-21T00:00:00.000Z',
      source: 'cli', status: 'active', isLatest: true,
    });
    await structured.upsertEntity({ id: 'ent_seed', name: 'Sentinel', type: 'concept', mentionCount: 1 });
    await structured.upsertEntity({ id: 'ent_hop1', name: 'Neighbor', type: 'concept', mentionCount: 1 });
    // seed → neighbor (entity-to-entity)
    await structured.storeEdge({
      id: 'e_seed_hop1',
      from: { type: 'entity', id: 'ent_seed' },
      to: { type: 'entity', id: 'ent_hop1' },
      relation: 'related', confidence: 1.0, sharedTags: [], method: 'manual',
      createdAt: '2026-05-21T00:00:00.000Z',
    });
    // hop1 → memory
    await structured.storeEdge({
      id: 'e_hop1_mem',
      from: { type: 'entity', id: 'ent_hop1' },
      to: { type: 'memory', id: 'mem_hop1' },
      relation: 'mentioned-in', confidence: 1.0, sharedTags: [], method: 'manual',
      createdAt: '2026-05-21T00:00:00.000Z',
    });

    const api = createRetrieve(deps);
    const result = await api.factRetrieval({ query: 'sentinel' });
    const hopped = result.data.find((r) => r.memory.id === 'mem_hop1');
    expect(hopped).toBeDefined();
    expect(hopped?.why).toBe('fact-retrieval/graph_expansion');
  });

  it('layer 4 — bridge surfaces memories connecting ≥ 2 seed entities', async () => {
    // Memory linked to two distinct query-matched entities. Bridge layer
    // gives it a higher score than a single-entity-linked memory.
    await structured.storeMemory({
      id: 'mem_bridge', title: 'Bridge', summary: '', content: 'connective hub',
      tags: [], priority: 0.5, tier: 'warm', decayScore: 0, accessCount: 0,
      isPinned: false, contentHash: 'br', createdAt: '2026-05-21T00:00:00.000Z',
      source: 'cli', status: 'active', isLatest: true,
    });
    await structured.upsertEntity({ id: 'ent_alpha', name: 'Alpha', type: 'concept', mentionCount: 1 });
    await structured.upsertEntity({ id: 'ent_beta', name: 'Beta', type: 'concept', mentionCount: 1 });
    await structured.storeEdge({
      id: 'e_a_m', from: { type: 'entity', id: 'ent_alpha' }, to: { type: 'memory', id: 'mem_bridge' },
      relation: 'mentioned-in', confidence: 1.0, sharedTags: [], method: 'manual',
      createdAt: '2026-05-21T00:00:00.000Z',
    });
    await structured.storeEdge({
      id: 'e_b_m', from: { type: 'entity', id: 'ent_beta' }, to: { type: 'memory', id: 'mem_bridge' },
      relation: 'mentioned-in', confidence: 1.0, sharedTags: [], method: 'manual',
      createdAt: '2026-05-21T00:00:00.000Z',
    });

    const api = createRetrieve(deps);
    const result = await api.factRetrieval({ query: 'alpha beta' });
    const bridged = result.data.find((r) => r.memory.id === 'mem_bridge');
    expect(bridged).toBeDefined();
    expect(bridged?.why).toBe('fact-retrieval/bridge');
  });

  it('parity-harness smoke test — factRetrieval can be wired into runParityHarness', async () => {
    const { runParityHarness } = await import('@kybernesis/arcana-testkit/parity');
    await structured.storeMemory({
      id: 'mem_p', title: 'parity probe', summary: '', content: 'kybernesis',
      tags: [], priority: 0.5, tier: 'warm', decayScore: 0, accessCount: 0,
      isPinned: false, contentHash: 'p', createdAt: '2026-05-21T00:00:00.000Z',
      source: 'cli', status: 'active', isLatest: true,
    });
    const api = createRetrieve(deps);
    const queryFn = (input: unknown) => api.factRetrieval(input as { query: string });
    const report = await runParityHarness({
      queries: [{ id: 'q1', input: { query: 'kybernesis' } }],
      baseline: queryFn,
      candidate: queryFn,
      extractIds: (r) => r.data.map((row) => row.memory.id),
    });
    expect(report.passes).toBe(true);
    expect(report.meanOverlap).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// hybridSearch — RRF fusion across FTS + vector + graph channels
// ---------------------------------------------------------------------------

const baseMemory = (overrides: Partial<Memory>): Memory => ({
  id: 'mem',
  title: '',
  summary: '',
  content: '',
  tags: [],
  priority: 0.5,
  tier: 'warm',
  decayScore: 0,
  accessCount: 0,
  isPinned: false,
  contentHash: 'h',
  createdAt: "2026-05-21T00:00:00.000Z",
  source: 'cli',
  status: 'active',
  isLatest: true,
  ...overrides,
});

function makeVector(matches: Array<{ id: string; memoryId: string; score: number }> = []): VectorStore {
  return {
    connect: async () => {},
    disconnect: async () => {},
    upsert: async () => {},
    query: async () => matches.map((m) => ({ id: m.id, score: m.score, metadata: { memoryId: m.memoryId } })),
    delete: async () => {},
  };
}

function makeEmbed(): EmbeddingProvider {
  return {
    model: 'fake',
    dimensions: 4,
    embed: async () => [0.1, 0.2, 0.3, 0.4],
    embedBatch: async (texts) => texts.map(() => [0.1, 0.2, 0.3, 0.4]),
  };
}

describe('hybridSearch', () => {
  it('returns empty array when no channels match', async () => {
    const api = createRetrieve({ ...deps, vector: makeVector(), embed: makeEmbed() });
    const result = await api.hybridSearch({ query: 'nothing-matches' });
    expect(result.data).toEqual([]);
  });

  it('keyword-only match flows through the keyword channel', async () => {
    await structured.storeMemory(baseMemory({ id: 'mem_kw', title: 'hybrid retrieval is great', content: 'kybernesis' }));
    const api = createRetrieve({ ...deps, vector: makeVector(), embed: makeEmbed() });
    const result = await api.hybridSearch({ query: 'kybernesis' });
    expect(result.data.length).toBe(1);
    expect(result.data[0]?.memory.id).toBe('mem_kw');
    expect(result.data[0]?.matchType).toBe('keyword');
    expect(result.data[0]?.keywordScore).toBeGreaterThan(0);
    expect(result.data[0]?.semanticScore).toBe(0);
    expect(result.data[0]?.graphScore).toBe(0);
  });

  it('memory appearing in both keyword and semantic channels is marked "both"', async () => {
    await structured.storeMemory(baseMemory({ id: 'mem_both', title: 'matched in both channels', content: 'kybernesis' }));
    await structured.storeMemory(baseMemory({ id: 'mem_kw_only', title: 'kybernesis only matched in keyword', content: 'kybernesis' }));

    const vector = makeVector([{ id: 'chunk_1', memoryId: 'mem_both', score: 0.9 }]);
    const api = createRetrieve({ ...deps, vector, embed: makeEmbed() });

    const result = await api.hybridSearch({ query: 'kybernesis' });
    const both = result.data.find((r) => r.memory.id === 'mem_both');
    const kwOnly = result.data.find((r) => r.memory.id === 'mem_kw_only');
    expect(both?.matchType).toBe('both');
    expect(both?.keywordScore).toBeGreaterThan(0);
    expect(both?.semanticScore).toBeGreaterThan(0);
    expect(both?.graphScore).toBe(0);
    expect(kwOnly?.matchType).toBe('keyword');
    // Multi-channel item should outrank single-channel item under RRF
    expect(both!.score).toBeGreaterThan(kwOnly!.score);
  });

  it('temporal channel contributes an RRF vote in addition to keyword', async () => {
    // Single matching memory; verify its score reflects contributions from
    // both the keyword channel AND the temporal channel (4-channel topology
    // collapses to keyword-bucket score field, but the SUM in `score` carries
    // both contributions).
    await structured.storeMemory(baseMemory({
      id: 'mem_recent',
      title: 'kybernesis fresh',
      content: 'kybernesis',
      createdAt: '2026-05-21T00:00:00.000Z',
    }));
    const api = createRetrieve({ ...deps, vector: makeVector(), embed: makeEmbed() });
    const result = await api.hybridSearch({ query: 'kybernesis' });
    expect(result.data).toHaveLength(1);
    const hit = result.data[0]!;
    // Single-channel keyword RRF contribution at rank 0 = 1/(60+1) = 1/61.
    // With temporal also contributing rank 0 = 1/61, total = 2/61.
    const singleChannelRrf = 1 / 61;
    expect(hit.score).toBeGreaterThan(singleChannelRrf * 1.5);
    expect(hit.keywordScore).toBeGreaterThan(0);
  });

  it('newer memory ranks above older when both match keyword (temporal tiebreak)', async () => {
    // Two memories match the keyword; the newer one matches MORE query tokens
    // (so keyword channel ranks it first too) AND has a later createdAt (so
    // temporal channel ranks it first). Both effects compound under RRF.
    await structured.storeMemory(baseMemory({
      id: 'mem_old',
      title: 'kybernesis ancient',
      content: 'kybernesis old',
      createdAt: '2024-01-01T00:00:00.000Z',
    }));
    await structured.storeMemory(baseMemory({
      id: 'mem_new',
      title: 'kybernesis fresh sparkly',
      content: 'kybernesis fresh sparkly',
      createdAt: '2026-05-21T00:00:00.000Z',
    }));
    const api = createRetrieve({ ...deps, vector: makeVector(), embed: makeEmbed() });
    const result = await api.hybridSearch({ query: 'kybernesis fresh sparkly' });
    const newer = result.data.find((r) => r.memory.id === 'mem_new');
    const older = result.data.find((r) => r.memory.id === 'mem_old');
    expect(newer).toBeDefined();
    expect(older).toBeDefined();
    expect(newer!.score).toBeGreaterThan(older!.score);
  });

  it('entity-name-filter channel surfaces memories linked to matching entities', async () => {
    // A memory unrelated to the query keyword, but linked via an entity name match.
    await structured.storeMemory(baseMemory({
      id: 'mem_linked',
      title: 'unrelated title',
      content: 'unrelated content',
    }));
    await structured.upsertEntity({
      id: 'ent_kyb',
      name: 'Kybernesis',
      type: 'company',
      mentionCount: 1,
    });
    await structured.storeEdge({
      id: 'edge_e',
      from: { type: 'entity', id: 'ent_kyb' },
      to: { type: 'memory', id: 'mem_linked' },
      relation: 'mentioned-in',
      confidence: 1.0,
      sharedTags: [],
      method: 'manual',
      createdAt: '2026-05-21T00:00:00.000Z',
    });

    const api = createRetrieve({ ...deps, vector: makeVector(), embed: makeEmbed() });
    const result = await api.hybridSearch({ query: 'kybernesis' });
    const ids = result.data.map((r) => r.memory.id);
    expect(ids).toContain('mem_linked');
    const linked = result.data.find((r) => r.memory.id === 'mem_linked');
    expect(linked?.matchType).toBe('keyword'); // entity channel collapses into keyword bucket per KB
    expect(linked?.keywordScore).toBeGreaterThan(0);
  });

  it('graphHops parameter is accepted but ignored (deprecated since v0.4.0)', async () => {
    await structured.storeMemory(baseMemory({ id: 'mem_a', title: 'kybernesis', content: 'kybernesis' }));
    const api = createRetrieve({ ...deps, vector: makeVector(), embed: makeEmbed() });
    const withHops = await api.hybridSearch({ query: 'kybernesis', graphHops: 5 });
    const withoutHops = await api.hybridSearch({ query: 'kybernesis' });
    expect(withHops.data.map((r) => r.memory.id)).toEqual(withoutHops.data.map((r) => r.memory.id));
    // graphScore must be 0 on every result regardless of graphHops
    for (const r of withHops.data) expect(r.graphScore).toBe(0);
  });

  it('respects topK', async () => {
    for (let i = 0; i < 5; i++) {
      await structured.storeMemory(baseMemory({ id: `mem_${i}`, title: `widget ${i}`, content: 'widget' }));
    }
    const api = createRetrieve({ ...deps, vector: makeVector(), embed: makeEmbed() });
    const result = await api.hybridSearch({ query: 'widget', topK: 2 });
    expect(result.data.length).toBe(2);
  });

  it('survives a failing semantic channel (returns keyword-only)', async () => {
    await structured.storeMemory(baseMemory({ id: 'mem_kw', title: 'kybernesis only', content: 'kybernesis' }));
    const brokenVector: VectorStore = {
      connect: async () => {},
      disconnect: async () => {},
      upsert: async () => {},
      query: async () => { throw new Error('vector store offline'); },
      delete: async () => {},
    };
    const api = createRetrieve({ ...deps, vector: brokenVector, embed: makeEmbed() });
    const result = await api.hybridSearch({ query: 'kybernesis' });
    expect(result.data.length).toBe(1);
    expect(result.data[0]?.matchType).toBe('keyword');
  });

  it('calls reranker when rerank=true and a reranker is supplied', async () => {
    await structured.storeMemory(baseMemory({ id: 'mem_a', title: 'kybernesis a', content: 'kybernesis' }));
    await structured.storeMemory(baseMemory({ id: 'mem_b', title: 'kybernesis b', content: 'kybernesis' }));
    let rerankCalled = false;
    const reranker: RerankerProvider = {
      model: 'fake-rerank',
      rerank: async (_q, candidates) => {
        rerankCalled = true;
        return candidates.slice().reverse();
      },
    };
    const api = createRetrieve({ ...deps, vector: makeVector(), embed: makeEmbed(), reranker });
    const result = await api.hybridSearch({ query: 'kybernesis', rerank: true });
    expect(rerankCalled).toBe(true);
    expect(result.data.length).toBe(2);
  });

  it('wraps result in QueryResult envelope', async () => {
    const api = createRetrieve({ ...deps, vector: makeVector(), embed: makeEmbed() });
    const result = await api.hybridSearch({ query: 'anything' });
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('generated_at');
    expect(result).toHaveProperty('data_age_ms', 0);
    expect(result).toHaveProperty('stale', false);
  });

  it('parity-harness smoke test — hybridSearch can be wired into runParityHarness', async () => {
    // Sanity check that v0.4.0's hybridSearch can be supplied as a candidate
    // to the parity harness shipped in v0.3.0. The real parity test (against
    // KyberBot's actual hybrid-search.ts) lives in KyberBot's repo per ADR 009.
    const { runParityHarness } = await import('@kybernesis/arcana-testkit/parity');
    await structured.storeMemory(baseMemory({ id: 'mem_x', title: 'kybernesis', content: 'kybernesis' }));
    const api = createRetrieve({ ...deps, vector: makeVector(), embed: makeEmbed() });
    const queryFn = (input: unknown) =>
      api.hybridSearch(input as { query: string });
    const report = await runParityHarness({
      queries: [{ id: 'q1', input: { query: 'kybernesis' } }],
      baseline: queryFn,
      candidate: queryFn,
      extractIds: (r) => r.data.map((row) => row.memory.id),
    });
    expect(report.passes).toBe(true);
    expect(report.meanOverlap).toBe(1);
  });
});
