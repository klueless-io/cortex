import { describe, it, expect, vi } from 'vitest';
import { runLinkMemories } from './link-memories.js';
import type { MaintainDeps } from '../index.js';
import type { Memory, StructuredStore, Logger } from '@kybernesis/cortex-contracts';
import { DEFAULT_CONFIG } from '../config.js';

function makeMemory(id: string, tags: string[], title = 'Memory'): Memory {
  return {
    id,
    title,
    summary: '',
    content: 'content',
    tags,
    priority: 0.5,
    tier: 'warm',
    decayScore: 0.1,
    accessCount: 1,
    createdAt: new Date().toISOString(),
    isPinned: false,
    contentHash: 'abc',
    source: 'chat',
    status: 'active',
    isLatest: true,
  };
}

function makeDeps(memories: Memory[]): MaintainDeps {
  const storeEdge = vi.fn().mockResolvedValue(undefined);
  const structured = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    storeMemory: vi.fn(),
    getMemory: vi.fn().mockResolvedValue(null),
    listMemories: vi.fn().mockResolvedValue(memories),
    updateMemory: vi.fn().mockResolvedValue(undefined),
    markMemorySuperseded: vi.fn(),
    deleteMemory: vi.fn().mockResolvedValue(undefined),
    storeChunks: vi.fn(),
    getChunksForMemory: vi.fn().mockResolvedValue([]),
    upsertEntity: vi.fn(),
    getEntity: vi.fn().mockResolvedValue(null),
    listEntities: vi.fn().mockResolvedValue([]),
    deleteEntity: vi.fn().mockResolvedValue(undefined),
    storeEdge,
    getNeighbors: vi.fn().mockResolvedValue([]),
    getEdgesFor: vi.fn().mockResolvedValue([]),
    storeFact: vi.fn().mockResolvedValue(undefined),
    getFact: vi.fn().mockResolvedValue(null),
    getFactsForEntity: vi.fn().mockResolvedValue([]),
    markFactSuperseded: vi.fn(),
    expireFacts: vi.fn().mockResolvedValue(0),
    decayFactConfidence: vi.fn().mockResolvedValue(0),
    searchFulltext: vi.fn().mockResolvedValue([]),
    searchFactsFulltext: vi.fn().mockResolvedValue([]),
    storeContradiction: vi.fn(),
    listContradictions: vi.fn().mockResolvedValue([]),
    storeInsight: vi.fn().mockResolvedValue(undefined),
    listInsights: vi.fn().mockResolvedValue([]),
    storeEntityProfile: vi.fn().mockResolvedValue(undefined),
    getEntityProfile: vi.fn().mockResolvedValue(null),
    getAgentSelf: vi.fn().mockResolvedValue(null),
    updateAgentSelf: vi.fn(),
  } as unknown as StructuredStore;

  const logger: Logger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  };

  return { structured, logger } as unknown as MaintainDeps;
}

describe('runLinkMemories — tag-vocabulary convention', () => {
  const config = { ...DEFAULT_CONFIG, minConfidenceForLink: 0.15 };

  it('creates an edge when two memories share topic:* tags', async () => {
    const memories = [
      makeMemory('a', ['type:conversation', 'entity:Alice', 'topic:kubernetes', 'topic:deployment']),
      makeMemory('b', ['type:note', 'entity:Bob', 'topic:kubernetes', 'topic:deployment']),
    ];
    const deps = makeDeps(memories);
    const result = await runLinkMemories(deps, config);

    expect(result.count).toBe(1);
    expect((deps.structured.storeEdge as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it('does not create an edge when memories share only type:* or entity:* tags', async () => {
    // Both memories share type:conversation and entity:Alice but NO topic: tags
    const memories = [
      makeMemory('a', ['type:conversation', 'entity:Alice']),
      makeMemory('b', ['type:conversation', 'entity:Alice']),
    ];
    const deps = makeDeps(memories);
    const result = await runLinkMemories(deps, config);

    expect(result.count).toBe(0);
    expect((deps.structured.storeEdge as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('does not create an edge when memories share plain (non-prefixed) tags that previously would have matched', async () => {
    // Before the fix, two memories sharing bare tag 'kubernetes' would have linked.
    // After the fix, bare tags are ignored — only topic:kubernetes counts.
    const memories = [
      makeMemory('a', ['kubernetes', 'deployment', 'infrastructure']),
      makeMemory('b', ['kubernetes', 'deployment', 'infrastructure']),
    ];
    const deps = makeDeps(memories);
    const result = await runLinkMemories(deps, config);

    // No topic:* tags → no tag sets → no edges
    expect(result.count).toBe(0);
  });

  it('strips the topic: prefix before comparing — topic:foo and topic:foo match as "foo"', async () => {
    const memories = [
      makeMemory('a', ['topic:planning', 'topic:roadmap', 'topic:strategy']),
      makeMemory('b', ['topic:planning', 'topic:roadmap', 'topic:strategy']),
    ];
    const deps = makeDeps(memories);
    const result = await runLinkMemories(deps, config);

    expect(result.count).toBe(1);
    const call = (deps.structured.storeEdge as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // sharedTags should be stripped values, not prefixed
    expect(call.sharedTags).toEqual(expect.arrayContaining(['planning', 'roadmap', 'strategy']));
    expect(call.sharedTags.some((t: string) => t.startsWith('topic:'))).toBe(false);
  });
});
