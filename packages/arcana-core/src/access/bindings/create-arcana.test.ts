import { describe, it, expect } from 'vitest';
import type {
  StructuredStore,
  VectorStore,
  EmbeddingProvider,
  LLMProvider,
  Logger,
} from '@kybernesis/arcana-contracts';
import { createArcana, type ArcanaOptions } from './create-arcana.js';
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

function makeFakes(): ArcanaOptions {
  return {
    structured: makeFakeStructured(),
    vector: makeFakeVector(),
    embed: makeFakeEmbed(),
    llm: makeFakeLLM(),
  };
}

describe('createArcana', () => {
  it('returns an object with all five zones, providers, and logger', () => {
    const arcana = createArcana(makeFakes());
    expect(arcana.ingest).toBeDefined();
    expect(arcana.retrieve).toBeDefined();
    expect(arcana.maintain).toBeDefined();
    expect(arcana.query).toBeDefined();
    expect(arcana.command).toBeDefined();
    expect(arcana.providers).toBeDefined();
    expect(arcana.logger).toBeDefined();
  });

  it('still-stubbed zone methods throw NotImplementedError', async () => {
    // storeMemory + hybridSearch + sleep pipeline have been implemented (v1.1.0).
    // ingestDocument remains a stub.
    // See packages/arcana-core/src/{ingest,retrieve,maintain}/ for the live tests.
    const arcana = createArcana(makeFakes());
    await expect(
      arcana.ingest.ingestDocument({ format: 'markdown', content: '# x' }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('ingest.storeMemory is now wired end-to-end through the kernel', async () => {
    const fakes = makeFakes();
    const arcana = createArcana(fakes);
    const id = await arcana.ingest.storeMemory({
      content: 'wired through createArcana',
      source: 'cli',
    });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('freezes the providers object (mutation throws in strict mode)', () => {
    const arcana = createArcana(makeFakes());
    expect(Object.isFrozen(arcana.providers)).toBe(true);
    expect(() => {
      (arcana.providers as { llm: unknown }).llm = null;
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
    const arcana = createArcana({ ...makeFakes(), logger: customLogger });
    expect(arcana.logger).toBe(customLogger);
    arcana.logger.info('hello');
    expect(calls).toEqual(['info:hello']);
  });

  it('falls back to a working no-op logger when none is injected', () => {
    const arcana = createArcana(makeFakes());
    expect(() => arcana.logger.info('x')).not.toThrow();
    expect(() => arcana.logger.debug('x')).not.toThrow();
    expect(() => arcana.logger.warn('x')).not.toThrow();
    expect(() => arcana.logger.error('x')).not.toThrow();
  });

  it('vector is optional — omitting it still constructs a valid Arcana instance', () => {
    const { vector: _v, ...noVector } = makeFakes();
    const arcana = createArcana(noVector);
    expect(arcana.retrieve).toBeDefined();
    expect(arcana.providers.vector).toBeUndefined();
  });

  it('scheduler fallback throws NotImplementedError when used without injection', async () => {
    const arcana = createArcana(makeFakes());
    // Reach the scheduler through providers — when omitted, .providers.scheduler is undefined;
    // the internal fallback is what maintain would use. We can't reach it directly, so we
    // verify the related maintain method still surfaces NotImplementedError.
    await expect(
      arcana.maintain.startSleepSchedule(1000),
    ).rejects.toBeInstanceOf(NotImplementedError);
    expect(arcana.providers.scheduler).toBeUndefined();
    expect(arcana.providers.queue).toBeUndefined();
  });
});
