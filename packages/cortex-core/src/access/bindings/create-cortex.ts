import {
  createNoopLogger,
  type StructuredStore,
  type VectorStore,
  type EmbeddingProvider,
  type LLMProvider,
  type RerankerProvider,
  type Scheduler,
  type JobQueue,
  type Logger,
} from '@kybernesis/cortex-contracts';
import { createIngest, type IngestApi } from '../../ingest/index.js';
import { createRetrieve, type RetrieveApi } from '../../retrieve/index.js';
import { createMaintain, type MaintainApi } from '../../maintain/index.js';
import { createQuery, type QueryApi } from '../query/index.js';
import { createCommand, type CommandApi } from '../command/index.js';
import { NotImplementedError } from '../../errors.js';

/**
 * Options for assembling an Cortex instance. Required providers must be
 * injected — Cortex never imports a concrete backend.
 */
export interface CortexOptions {
  /** Required: structured store (SQL-shaped CRUD + FTS + graph). */
  structured: StructuredStore;
  /**
   * Optional: vector store for semantic retrieval. When omitted, all
   * vector-dependent methods throw NotImplementedError — the same behaviour as
   * when a real store is injected but the read methods are still stubbed.
   * Pass undefined (or omit) when the vector backend is unavailable; do NOT
   * pass a store whose connect() already failed, as that produces misleading
   * downstream errors.
   */
  vector?: VectorStore;
  /** Required: embedding provider. */
  embed: EmbeddingProvider;
  /** Required: LLM provider for extraction, tagging, summarisation. */
  llm: LLMProvider;
  /** Optional logger; defaults to a no-op logger. */
  logger?: Logger;
  /** Optional reranker for retrieval re-ordering. */
  reranker?: RerankerProvider;
  /**
   * Optional scheduler for the sleep pipeline. If omitted, maintain methods
   * that need a scheduler throw NotImplementedError when called.
   */
  scheduler?: Scheduler;
  /**
   * Optional job queue for the sleep pipeline. If omitted, maintain methods
   * that need a queue throw NotImplementedError when called.
   */
  queue?: JobQueue;
  /**
   * Reserved for v0.x — when true, Cortex will install process signal
   * handlers (SIGINT/SIGTERM) for graceful shutdown. v0.1 accepts and
   * stores the flag but does not register handlers yet.
   * @default true
   */
  installSignalHandlers?: boolean;
}

/**
 * Resolved Cortex instance — the public surface returned by `createCortex()`.
 * `.providers` is frozen so consumers can't mutate the injected dependency
 * graph after construction.
 */
export interface Cortex {
  ingest: IngestApi;
  retrieve: RetrieveApi;
  maintain: MaintainApi;
  query: QueryApi;
  command: CommandApi;
  providers: Readonly<CortexOptions>;
  logger: Logger;
}

/**
 * No-op VectorStore fallback used when the caller does not inject one (or
 * when vector connect failed and the caller wants to degrade gracefully).
 * Every method throws NotImplementedError so consumers get a clear message
 * instead of a cryptic "connect() must be called first" from a broken instance.
 */
function createMissingVectorStore(): VectorStore {
  const fail = (method: string): never => {
    throw new NotImplementedError(
      `cortex-core: VectorStore.${method} called but no vector store was injected into createCortex()`,
    );
  };
  return {
    connect: async () => fail('connect'),
    disconnect: async () => fail('disconnect'),
    upsert: async () => fail('upsert'),
    query: () => fail('query'),
    delete: async () => fail('delete'),
  };
}

/**
 * No-op Scheduler fallback used when the caller does not inject one. Every
 * method throws NotImplementedError, so maintain operations that genuinely
 * need a scheduler fail fast with a clear message instead of hanging.
 */
function createMissingScheduler(): Scheduler {
  const fail = (method: string): never => {
    throw new NotImplementedError(
      `cortex-core: Scheduler.${method} called but no scheduler was injected into createCortex()`,
    );
  };
  return {
    schedule: () => fail('schedule'),
    cancel: () => fail('cancel'),
    now: () => fail('now'),
  };
}

/**
 * No-op JobQueue fallback used when the caller does not inject one. Every
 * method throws NotImplementedError, so maintain operations that genuinely
 * need a queue fail fast with a clear message instead of silently succeeding.
 */
function createMissingQueue(): JobQueue {
  const fail = (method: string): never => {
    throw new NotImplementedError(
      `cortex-core: JobQueue.${method} called but no queue was injected into createCortex()`,
    );
  };
  return {
    enqueue: () => fail('enqueue'),
    process: () => fail('process'),
  };
}

/**
 * Assemble an Cortex instance from injected providers. Calls each zone
 * factory with the right deps subset and freezes the providers object so
 * downstream code cannot mutate the dependency graph.
 *
 * v0.1: every zone method throws NotImplementedError — this is the scaffold
 * milestone. Real implementations land in v0.x.
 */
export function createCortex(opts: CortexOptions): Cortex {
  const logger = opts.logger ?? createNoopLogger();
  const scheduler = opts.scheduler ?? createMissingScheduler();
  const queue = opts.queue ?? createMissingQueue();
  const vector = opts.vector ?? createMissingVectorStore();

  const ingest = createIngest({
    structured: opts.structured,
    vector,
    embed: opts.embed,
    llm: opts.llm,
    logger,
  });

  const retrieve = createRetrieve({
    structured: opts.structured,
    vector,
    embed: opts.embed,
    reranker: opts.reranker,
    logger,
  });

  const maintain = createMaintain({
    structured: opts.structured,
    vector,
    embed: opts.embed,
    llm: opts.llm,
    scheduler,
    queue,
    logger,
  });

  const query = createQuery({
    structured: opts.structured,
    logger,
  });

  const command = createCommand({
    structured: opts.structured,
    vector,
    logger,
  });

  return {
    ingest,
    retrieve,
    maintain,
    query,
    command,
    providers: Object.freeze({ ...opts }),
    logger,
  };
}
