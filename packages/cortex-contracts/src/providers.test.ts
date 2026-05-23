/**
 * Provider interfaces are TypeScript-only contracts (no runtime code). These
 * tests verify the interfaces are *implementable* by constructing minimal
 * fake adapters and exercising their shape. Richer in-memory fakes for the
 * full compliance suite will live in @kybernesis/cortex-testkit.
 */

import { describe, it, expect } from 'vitest';
import type {
  StructuredStore,
  VectorStore,
  EmbeddingProvider,
  LLMProvider,
  RerankerProvider,
  Scheduler,
  JobQueue,
  FulltextMatch,
} from './providers.js';
import type { Memory } from './memory.js';

describe('Provider interfaces', () => {
  it('StructuredStore can be implemented by a minimal in-memory fake', async () => {
    const memories = new Map<string, Memory>();
    const fake: Pick<StructuredStore, 'connect' | 'disconnect' | 'storeMemory' | 'getMemory'> = {
      connect: async () => {},
      disconnect: async () => {},
      storeMemory: async (m) => {
        memories.set(m.id, m);
      },
      getMemory: async (id) => memories.get(id) ?? null,
    };

    await fake.connect();
    const memory: Memory = {
      id: 'mem_1',
      title: 't',
      summary: 's',
      content: 'c',
      tags: [],
      priority: 0,
      tier: 'warm',
      decayScore: 0,
      accessCount: 0,
      isPinned: false,
      contentHash: 'h',
      createdAt: "2026-05-21T00:00:00.000Z",
      source: 'cli',
    };
    await fake.storeMemory(memory);
    expect(await fake.getMemory('mem_1')).toEqual(memory);
    expect(await fake.getMemory('missing')).toBeNull();
    await fake.disconnect();
  });

  it('StructuredStore.searchFulltext shape is implementable', async () => {
    const fake: Pick<StructuredStore, 'searchFulltext'> = {
      searchFulltext: async (query, opts) => {
        if (!query) return [];
        const match: FulltextMatch = {
          memoryId: 'mem_1',
          score: 0.8,
          matchedFields: opts?.fields ?? ['title', 'content'],
        };
        return [match];
      },
    };
    const r = await fake.searchFulltext('hello', { topK: 5 });
    expect(r[0]?.memoryId).toBe('mem_1');
    expect(r[0]?.score).toBeGreaterThan(0);
    expect(r[0]?.matchedFields).toContain('title');
  });

  it('StructuredStore.getFactsForEntity accepts optional asOf', async () => {
    const fake: Pick<StructuredStore, 'getFactsForEntity'> = {
      getFactsForEntity: async (entity, _attribute, asOf) => {
        // Compile-check: asOf is string | undefined
        const stamp: string | undefined = asOf;
        return stamp ? [] : [];
      },
    };
    expect(await fake.getFactsForEntity('e1')).toEqual([]);
    expect(await fake.getFactsForEntity('e1', undefined, '2026-01-01T00:00:00.000Z')).toEqual([]);
  });

  it('VectorStore can be implemented', async () => {
    const items = new Map<string, { vector: number[]; metadata?: Record<string, unknown> }>();
    const fake: VectorStore = {
      connect: async () => {},
      disconnect: async () => {},
      upsert: async (toInsert) => {
        for (const i of toInsert) items.set(i.id, { vector: i.vector, metadata: i.metadata });
      },
      query: async () => [],
      delete: async (ids) => {
        for (const id of ids) items.delete(id);
      },
    };
    await fake.upsert([{ id: 'v1', vector: [1, 2, 3] }]);
    expect(items.size).toBe(1);
    await fake.delete(['v1']);
    expect(items.size).toBe(0);
  });

  it('EmbeddingProvider can be implemented', async () => {
    const fake: EmbeddingProvider = {
      model: 'test-embed',
      dimensions: 4,
      embed: async (text) => Array.from(text).slice(0, 4).map((c) => c.charCodeAt(0)),
      embedBatch: async (texts) =>
        texts.map((t) => Array.from(t).slice(0, 4).map((c) => c.charCodeAt(0))),
    };
    expect(fake.model).toBe('test-embed');
    expect(fake.dimensions).toBe(4);
    expect((await fake.embed('abcd')).length).toBe(4);
    expect((await fake.embedBatch(['x', 'y'])).length).toBe(2);
  });

  it('LLMProvider can be implemented', async () => {
    const fake: LLMProvider = {
      model: 'test-llm',
      complete: async (prompt) => `echo: ${prompt}`,
    };
    expect(await fake.complete('hi')).toBe('echo: hi');
  });

  it('RerankerProvider can be implemented', async () => {
    const fake: RerankerProvider = {
      model: 'test-rerank',
      rerank: async (_query, candidates) => candidates.slice().reverse(),
    };
    const reranked = await fake.rerank('q', [{ text: 'a' }, { text: 'b' }]);
    expect(reranked[0]?.text).toBe('b');
  });

  it('Scheduler can be implemented', async () => {
    const scheduled = new Set<string>();
    const fake: Scheduler = {
      schedule: async (name) => {
        scheduled.add(name);
      },
      cancel: async (name) => {
        scheduled.delete(name);
      },
      now: () => new Date('2026-05-18T08:00:00.000Z'),
    };
    await fake.schedule('sleep', 3600_000, async () => {});
    expect(scheduled.has('sleep')).toBe(true);
    expect(fake.now().toISOString()).toBe('2026-05-18T08:00:00.000Z');
  });

  it('JobQueue can be implemented', async () => {
    const handlers = new Map<string, (p: unknown) => Promise<void>>();
    const fake: JobQueue = {
      enqueue: async (name, payload) => {
        const handler = handlers.get(name);
        if (handler) await handler(payload);
        return `job_${name}`;
      },
      process: (name, handler) => {
        handlers.set(name, handler as (p: unknown) => Promise<void>);
      },
    };
    let received: unknown = null;
    fake.process<{ x: number }>('tick', async (p) => {
      received = p;
    });
    const id = await fake.enqueue('tick', { x: 42 });
    expect(id).toBe('job_tick');
    expect(received).toEqual({ x: 42 });
  });
});
