import { describe, it, expect } from 'vitest';
import type { Memory } from '@kybernesis/cortex-contracts';
import { createFakeStructuredStore } from './structured-store.js';

const sample: Memory = {
  id: 'mem_test',
  title: 'Test memory',
  summary: 'short',
  content: 'long content',
  tags: ['a', 'b'],
  priority: 0.5,
  tier: 'warm',
  decayScore: 0.1,
  accessCount: 0,
  isPinned: false,
  contentHash: 'hash',
  createdAt: "2026-05-21T00:00:00.000Z",
  source: 'cli',
};

describe('createFakeStructuredStore', () => {
  it('round-trips storeMemory + getMemory', async () => {
    const store = createFakeStructuredStore();
    await store.connect();
    await store.storeMemory(sample);
    expect(await store.getMemory('mem_test')).toEqual(sample);
    expect(await store.getMemory('missing')).toBeNull();
  });

  it('storeMemory throws when not connected', async () => {
    const store = createFakeStructuredStore();
    await expect(store.storeMemory(sample)).rejects.toThrow(/not connected/);
  });

  it('listMemories applies tier filter', async () => {
    const store = createFakeStructuredStore();
    await store.connect();
    await store.storeMemory({ ...sample, id: 'a', tier: 'hot' });
    await store.storeMemory({ ...sample, id: 'b', tier: 'warm' });
    await store.storeMemory({ ...sample, id: 'c', tier: 'archive' });
    const hot = await store.listMemories({ tier: 'hot' });
    expect(hot.map((m) => m.id)).toEqual(['a']);
  });

  it('deleteMemory removes the memory and its chunks', async () => {
    const store = createFakeStructuredStore();
    await store.connect();
    await store.storeMemory(sample);
    await store.storeChunks([
      { id: 'c1', memoryId: 'mem_test', text: 'x', layer: 'warm' },
    ]);
    await store.deleteMemory('mem_test');
    expect(await store.getMemory('mem_test')).toBeNull();
    expect(await store.getChunksForMemory('mem_test')).toEqual([]);
  });

  it('agent-self update is observable', async () => {
    const store = createFakeStructuredStore();
    await store.connect();
    expect(await store.getAgentSelf()).toBeNull();
    await store.updateAgentSelf({ memoryBlocks: [], history: [] });
    expect(await store.getAgentSelf()).toEqual({ memoryBlocks: [], history: [] });
  });

  // ── v1.2.0 — additional coverage closing audit gaps ─────────────────────────

  it('listMemories latestOnly:false returns superseded rows too', async () => {
    const store = createFakeStructuredStore();
    await store.connect();
    await store.storeMemory({ ...sample, id: 'mem_old', isLatest: false });
    await store.storeMemory({ ...sample, id: 'mem_new', isLatest: true });
    const allHistory = await store.listMemories({ latestOnly: false });
    expect(allHistory.map((m) => m.id).sort()).toEqual(['mem_new', 'mem_old']);
    const latestOnly = await store.listMemories();
    expect(latestOnly.map((m) => m.id)).toEqual(['mem_new']);
  });

  it('getNeighbors hops outside 1-5 throws on the fake too', async () => {
    const store = createFakeStructuredStore();
    await store.connect();
    await expect(
      store.getNeighbors({ type: 'memory', id: 'x' }, 0),
    ).rejects.toThrow(/hops must be 1-5/);
    await expect(
      store.getNeighbors({ type: 'memory', id: 'x' }, 6),
    ).rejects.toThrow(/hops must be 1-5/);
  });

  it('transaction passes the same store instance to fn (writes commit)', async () => {
    const store = createFakeStructuredStore();
    await store.connect();
    let received: unknown = null;
    await store.transaction(async (tx) => {
      received = tx;
      await tx.storeMemory(sample);
    });
    expect(received).toBe(store);
    expect(await store.getMemory(sample.id)).not.toBeNull();
  });

  it('deleteEntity cascade in fake removes edges + insights + entity_profile (not facts)', async () => {
    const store = createFakeStructuredStore();
    await store.connect();
    await store.upsertEntity({ id: 'ent_z', name: 'zoe', type: 'person', mentionCount: 1 });
    await store.storeEdge({
      id: 'e1', from: { type: 'entity', id: 'ent_z' },
      to: { type: 'memory', id: 'm1' }, relation: 'mentioned',
      confidence: 1, sharedTags: [], method: 't',
      createdAt: '2026-05-22T00:00:00.000Z',
    });
    await store.storeInsight({
      id: 'i1', entityId: 'ent_z', type: 'deduction',
      statement: 's', supportingFactIds: [], confidence: 0.9,
      createdAt: '2026-05-22T00:00:00.000Z',
    });
    await store.storeEntityProfile({
      id: 'p1', entityId: 'ent_z', staticFacts: [], dynamicContext: '',
      relatedEntityIds: [],
    });
    await store.storeFact({
      id: 'f1', fact: 'zoe is curious', entities: ['zoe'],
      category: 'general', confidence: 0.8, sourceType: 'ai-extraction',
      createdAt: '2026-05-22T00:00:00.000Z', isLatest: true,
    });

    await store.deleteEntity('ent_z');

    expect(await store.getEntity('ent_z')).toBeNull();
    expect(await store.getNeighbors({ type: 'entity', id: 'ent_z' })).toEqual([]);
    expect(await store.listInsights('ent_z')).toEqual([]);
    expect(await store.getEntityProfile('ent_z')).toBeNull();
    // Facts mentioning the deleted entity survive (multi-entity schema).
    const facts = await store.getFactsForEntity('zoe');
    expect(facts.length).toBe(1);
  });
});
