import { describe, it, expect } from 'vitest';
import type { Memory } from '@kybernesisai/arcana-contracts';
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
});
