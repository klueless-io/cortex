import { describe, it, expect } from 'vitest';
import type {
  StructuredStore,
  VectorStore,
  EmbeddingProvider,
  LLMProvider,
  Logger,
} from '@kybernesis/cortex-contracts';
import { createCortex, type CortexOptions } from './create-cortex.js';
import { NotImplementedError } from '../../errors.js';

/**
 * Minimal fakes — just enough to satisfy the interface shape. No real
 * behaviour; all kernel methods throw NotImplementedError at v0.1.
 */
function makeFakeStructured(): StructuredStore {
  const store: StructuredStore = {
    connect: async () => {},
    disconnect: async () => {},
    storeMemory: async () => {},
    getMemory: async () => null,
    listMemories: async () => [],
    updateMemory: async () => {},
    markMemorySuperseded: async () => {},
    deleteMemory: async () => {},
    storeChunks: async () => {},
    getChunksForMemory: async () => [],
    upsertEntity: async () => {},
    getEntity: async () => null,
    listEntities: async () => [],
    deleteEntity: async () => {},
    storeEdge: async () => {},
    getNeighbors: async () => [],
    storeFact: async () => {},
    getFact: async () => null,
    getFactsForEntity: async () => [],
    markFactSuperseded: async () => {},
    searchFulltext: async () => [],
    searchFactsFulltext: async () => [],
    storeContradiction: async () => {},
    listContradictions: async () => [],
    storeInsight: async () => {},
    listInsights: async () => [],
    storeEntityProfile: async () => {},
    getEntityProfile: async () => null,
    getAgentSelf: async () => null,
    updateAgentSelf: async () => {},
    transaction: async (fn) => fn(store),
  };
  return store;
}

function makeFakeVector(): VectorStore {
  return {
    connect: async () => {},
    disconnect: async () => {},
    upsert: async () => {},
    query: async () => [],
    delete: async () => {},
  };
}

function makeFakeEmbed(): EmbeddingProvider {
  return {
    model: 'fake-embed',
    dimensions: 3,
    embed: async () => [0, 0, 0],
    embedBatch: async (texts) => texts.map(() => [0, 0, 0]),
  };
}

function makeFakeLLM(): LLMProvider {
  return {
    model: 'fake-llm',
    complete: async () => 'fake',
  };
}

function makeFakes(): CortexOptions {
  return {
    structured: makeFakeStructured(),
    vector: makeFakeVector(),
    embed: makeFakeEmbed(),
    llm: makeFakeLLM(),
  };
}

describe('createCortex', () => {
  it('returns an object with all five zones, providers, and logger', () => {
    const cortex = createCortex(makeFakes());
    expect(cortex.ingest).toBeDefined();
    expect(cortex.retrieve).toBeDefined();
    expect(cortex.maintain).toBeDefined();
    expect(cortex.query).toBeDefined();
    expect(cortex.command).toBeDefined();
    expect(cortex.providers).toBeDefined();
    expect(cortex.logger).toBeDefined();
  });

  it('still-stubbed zone methods throw NotImplementedError', async () => {
    // storeMemory + hybridSearch + sleep pipeline have been implemented (v1.1.0).
    // ingestDocument remains a stub.
    // See packages/cortex-core/src/{ingest,retrieve,maintain}/ for the live tests.
    const cortex = createCortex(makeFakes());
    await expect(
      cortex.ingest.ingestDocument({ format: 'markdown', content: '# x' }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('ingest.storeMemory is now wired end-to-end through the kernel', async () => {
    const fakes = makeFakes();
    const cortex = createCortex(fakes);
    const id = await cortex.ingest.storeMemory({
      content: 'wired through createCortex',
      source: 'cli',
    });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('freezes the providers object (mutation throws in strict mode)', () => {
    const cortex = createCortex(makeFakes());
    expect(Object.isFrozen(cortex.providers)).toBe(true);
    expect(() => {
      (cortex.providers as { llm: unknown }).llm = null;
    }).toThrow();
  });

  it('uses an injected logger by reference', () => {
    const calls: string[] = [];
    const customLogger: Logger = {
      debug: (msg) => calls.push(`debug:${msg}`),
      info: (msg) => calls.push(`info:${msg}`),
      warn: (msg) => calls.push(`warn:${msg}`),
      error: (msg) => calls.push(`error:${msg}`),
    };
    const cortex = createCortex({ ...makeFakes(), logger: customLogger });
    expect(cortex.logger).toBe(customLogger);
    cortex.logger.info('hello');
    expect(calls).toEqual(['info:hello']);
  });

  it('falls back to a working no-op logger when none is injected', () => {
    const cortex = createCortex(makeFakes());
    expect(() => cortex.logger.info('x')).not.toThrow();
    expect(() => cortex.logger.debug('x')).not.toThrow();
    expect(() => cortex.logger.warn('x')).not.toThrow();
    expect(() => cortex.logger.error('x')).not.toThrow();
  });

  it('vector is optional — omitting it still constructs a valid Cortex instance', () => {
    const { vector: _v, ...noVector } = makeFakes();
    const cortex = createCortex(noVector);
    expect(cortex.retrieve).toBeDefined();
    expect(cortex.providers.vector).toBeUndefined();
  });

  it('scheduler fallback throws NotImplementedError when used without injection', async () => {
    const cortex = createCortex(makeFakes());
    // Reach the scheduler through providers — when omitted, .providers.scheduler is undefined;
    // the internal fallback is what maintain would use. We can't reach it directly, so we
    // verify the related maintain method still surfaces NotImplementedError.
    await expect(
      cortex.maintain.startSleepSchedule(1000),
    ).rejects.toBeInstanceOf(NotImplementedError);
    expect(cortex.providers.scheduler).toBeUndefined();
    expect(cortex.providers.queue).toBeUndefined();
  });
});
