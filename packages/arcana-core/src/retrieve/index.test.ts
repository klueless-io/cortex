import { describe, it, expect, beforeEach } from 'vitest';
import { createNoopLogger } from '@kybernesis/arcana-contracts';
import { createFakeStructuredStore } from '@kybernesis/arcana-testkit/fakes';
import { createRetrieve, type RetrieveDeps } from './index.js';
import { NotImplementedError } from '../errors.js';

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

  it('result includes why field indicating structured-only path', async () => {
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
      source: 'cli',
      status: 'active',
      isLatest: true,
    });

    const api = createRetrieve(deps);
    const result = await api.factRetrieval({ query: 'testing document' });

    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0]!.why).toBe('text-match (structured-only, no FTS5)');
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
});

// ---------------------------------------------------------------------------
// hybridSearch still throws NotImplementedError
// ---------------------------------------------------------------------------

describe('hybridSearch', () => {
  it('still throws NotImplementedError', async () => {
    const api = createRetrieve(deps);
    await expect(api.hybridSearch({ query: 'x' })).rejects.toThrow(NotImplementedError);
  });
});
