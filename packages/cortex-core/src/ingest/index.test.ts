import { describe, it, expect, beforeEach } from 'vitest';
import { createNoopLogger } from '@kybernesis/cortex-contracts';
import {
  createFakeStructuredStore,
  createFakeVectorStore,
  createFakeEmbeddingProvider,
  createFakeLLMProvider,
} from '@kybernesis/cortex-testkit/fakes';
import { createIngest, type IngestApi, type IngestDeps } from './index.js';
import { NotImplementedError } from '../errors.js';

let deps: IngestDeps;
let api: IngestApi;
let structured: ReturnType<typeof createFakeStructuredStore>;

beforeEach(async () => {
  structured = createFakeStructuredStore();
  await structured.connect();
  deps = {
    structured,
    vector: createFakeVectorStore(),
    embed: createFakeEmbeddingProvider(),
    llm: createFakeLLMProvider(),
    logger: createNoopLogger(),
  };
  api = createIngest(deps);
});

describe('ingest.storeMemory', () => {
  it('persists a memory and returns its id', async () => {
    const id = await api.storeMemory({
      content: 'Some test content',
      title: 'Test',
      source: 'cli',
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/); // UUID

    const stored = await structured.getMemory(id);
    expect(stored).not.toBeNull();
    expect(stored?.content).toBe('Some test content');
    expect(stored?.title).toBe('Test');
    expect(stored?.source).toBe('cli');
  });

  it('fills defaults for unspecified fields', async () => {
    const id = await api.storeMemory({ content: 'just content', source: 'chat' });
    const m = await structured.getMemory(id);
    expect(m?.title).toBe('');
    expect(m?.summary).toBe('');
    expect(m?.tags).toEqual([]);
    expect(m?.priority).toBe(0.5);
    expect(m?.tier).toBe('warm');
    expect(m?.decayScore).toBe(0);
    expect(m?.accessCount).toBe(0);
    expect(m?.isPinned).toBe(false);
    expect(m?.contentHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('computes deterministic contentHash for the same content', async () => {
    const id1 = await api.storeMemory({ content: 'same content', source: 'cli' });
    const id2 = await api.storeMemory({ content: 'same content', source: 'cli' });
    const m1 = await structured.getMemory(id1);
    const m2 = await structured.getMemory(id2);
    expect(m1?.contentHash).toBe(m2?.contentHash);
    // IDs are still different (UUID per call); dedup is the consumer's choice
    expect(id1).not.toBe(id2);
  });

  it('preserves caller-supplied tags + scopes', async () => {
    const id = await api.storeMemory({
      content: 'x',
      tags: ['type:conversation', 'entity:Alice'],
      source: 'channel',
      scopes: { project_id: 'proj_1', classification: 'internal' },
    });
    const m = await structured.getMemory(id);
    expect(m?.tags).toEqual(['type:conversation', 'entity:Alice']);
    expect(m?.scopes).toEqual({
      project_id: 'proj_1',
      classification: 'internal',
    });
  });

  it('rejects invalid source enum at validate time', async () => {
    await expect(
      api.storeMemory({ content: 'x', source: 'invalid-source' as never }),
    ).rejects.toThrow();
  });
});

describe('ingest.ingestDocument', () => {
  it('still throws NotImplementedError at this milestone', async () => {
    await expect(
      api.ingestDocument({ format: 'markdown', content: '# hi' }),
    ).rejects.toThrow(NotImplementedError);
  });
});

// ---------------------------------------------------------------------------
// extractFacts — KB-faithful real-time fact extraction (v1.0.0 / ADR 013)
// ---------------------------------------------------------------------------

describe('ingest.extractFacts (v1.0.0)', () => {
  // The fake LLM provider echoes the prompt. We override `complete` per-test
  // to return a chosen JSON response, simulating the LLM extraction step.
  const makeLLM = (response: string) => ({
    model: 'fake',
    complete: async () => response,
  });

  const seedMemory = async (overrides: Partial<{
    id: string;
    content: string;
    tags: string[];
    scopes: { org_id?: string; project_id?: string };
  }> = {}) => {
    const id = await api.storeMemory({
      content:
        overrides.content ??
        'A long enough conversation that Alice met Bob in Paris during summer 2026 to discuss the merger.',
      source: 'chat',
      tags: overrides.tags ?? [],
      scopes: overrides.scopes,
    });
    return id;
  };

  it('persists facts with v1.0.0 fields (entities[], category, sourceMemoryId)', async () => {
    deps.llm = makeLLM(JSON.stringify([
      {
        content: 'Alice met Bob in Paris during summer 2026',
        category: 'event',
        confidence: 0.85,
        entities: ['Alice', 'Bob', 'Paris'],
      },
    ]));
    api = createIngest(deps);
    const memId = await seedMemory({ tags: ['conversation:conv_99'] });
    const facts = await api.extractFacts(memId);
    expect(facts).toHaveLength(1);
    // v1.2.0 — entities normalised to lowercase + trim at storage.
    expect(facts[0]!.entities).toEqual(['alice', 'bob', 'paris']);
    expect(facts[0]!.category).toBe('event');
    expect(facts[0]!.sourceMemoryId).toBe(memId);
    expect(facts[0]!.sourceConversationId).toBe('conv_99');
    expect(facts[0]!.sourceType).toBe('ai-extraction');
  });

  it('rejects facts with empty entities[]', async () => {
    deps.llm = makeLLM(JSON.stringify([
      { content: 'X happened sometime', category: 'event', confidence: 0.7, entities: [] },
      { content: 'Real fact with entities included', category: 'event', confidence: 0.7, entities: ['Carol'] },
    ]));
    api = createIngest(deps);
    const memId = await seedMemory();
    const facts = await api.extractFacts(memId);
    expect(facts).toHaveLength(1);
    // v1.2.0 — entities normalised to lowercase.
    expect(facts[0]!.entities).toEqual(['carol']);
  });

  it('defaults invalid/unknown category to "general"', async () => {
    deps.llm = makeLLM(JSON.stringify([
      {
        content: 'David likes a strong cup of espresso',
        category: 'made-up-category',
        confidence: 0.8,
        entities: ['David'],
      },
    ]));
    api = createIngest(deps);
    const memId = await seedMemory();
    const facts = await api.extractFacts(memId);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.category).toBe('general');
  });

  it('returns [] when LLM returns no JSON array', async () => {
    deps.llm = makeLLM('I cannot find facts here.');
    api = createIngest(deps);
    const memId = await seedMemory();
    expect(await api.extractFacts(memId)).toEqual([]);
  });

  it('skips memories shorter than 50 chars (KB guard)', async () => {
    deps.llm = makeLLM(JSON.stringify([
      { content: 'should not be reached', category: 'event', confidence: 0.7, entities: ['X'] },
    ]));
    api = createIngest(deps);
    const memId = await seedMemory({ content: 'too short' });
    expect(await api.extractFacts(memId)).toEqual([]);
  });

  it('returns [] for unknown memory id', async () => {
    expect(await api.extractFacts('mem_does_not_exist')).toEqual([]);
  });

  it('caps to first 3 facts (KB pattern)', async () => {
    deps.llm = makeLLM(JSON.stringify(
      Array.from({ length: 6 }, (_, i) => ({
        content: `Concrete fact number ${i} about Alpha and Beta entities`,
        category: 'general',
        confidence: 0.7,
        entities: ['Alpha', 'Beta'],
      })),
    ));
    api = createIngest(deps);
    const memId = await seedMemory();
    const facts = await api.extractFacts(memId);
    expect(facts).toHaveLength(3);
  });
});
