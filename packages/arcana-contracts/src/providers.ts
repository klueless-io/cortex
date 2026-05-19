/**
 * Provider interfaces — the pluggable adapter ring around the Arcana kernel.
 *
 * These are minimal at v0.1: just enough surface to satisfy the kernel's
 * stubbed operations and the testkit's compliance suite. Additional methods
 * will land in v0.x as the kernel's ingest/retrieve/maintain zones gain real
 * implementations. New methods are additive — never break existing signatures.
 *
 * Implementation precedent (from arcana-spec.md §3):
 *   StructuredStore  : libsql (KyberBot), Convex (cloud), embedded SQLite
 *   VectorStore      : ChromaDB local, ChromaDB Cloud, embedded HNSW
 *   EmbeddingProvider: OpenAI text-embedding-3-*, local ONNX (Transformers.js)
 *   LLMProvider      : Anthropic SDK, Claude Code subscription, OpenAI
 *   RerankerProvider : Claude Haiku, Cohere — OPTIONAL
 *   Scheduler        : Node setInterval, Cloudflare Durable Object alarm, cron
 *   JobQueue         : in-process Promise chain, BullMQ + Redis
 */

import type { Memory, Chunk, Tier } from './memory.js';
import type { Entity } from './entity.js';
import type { Edge, NodeRef } from './edge.js';
import type { Fact, Contradiction } from './fact.js';
import type { Insight, EntityProfile } from './insight.js';
import type { AgentSelf } from './agent-self.js';
import type { Scopes } from './scopes.js';

/**
 * Persists the structured data model. Every provider implementation must pass
 * the @kybernesisai/arcana-testkit compliance suite.
 */
export interface StructuredStore {
  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Memory
  storeMemory(memory: Memory): Promise<void>;
  getMemory(id: string): Promise<Memory | null>;
  listMemories(filter?: MemoryFilter): Promise<Memory[]>;
  /**
   * Partial update of a Memory record. Only the supplied fields are
   * changed; everything else is left untouched. `scopes` (when supplied)
   * REPLACES the previous scopes object — no deep merge (matches Convex's
   * patch semantics; KyberBot wrappers can read-merge-write if column-by-
   * column update is needed).
   *
   * The `id` field is immutable. `contentHash` is recomputed by the kernel
   * when `content` is supplied — providers should NOT attempt to recompute
   * it themselves; they trust the kernel.
   */
  updateMemory(id: string, fields: Partial<Omit<Memory, 'id'>>): Promise<void>;
  /**
   * Mark a memory as superseded by another. Updates `isLatest=false` and
   * `supersededBy=newMemoryId` on the old memory. The new memory must already
   * exist (created via `storeMemory`); this is a pure link operation.
   * Mirrors `markFactSuperseded`. See ADR 007 §3.2.
   */
  markMemorySuperseded(oldMemoryId: string, newMemoryId: string): Promise<void>;
  deleteMemory(id: string): Promise<void>;

  // Chunk
  storeChunks(chunks: Chunk[]): Promise<void>;
  getChunksForMemory(memoryId: string): Promise<Chunk[]>;

  // Entity
  upsertEntity(entity: Entity): Promise<void>;
  getEntity(id: string): Promise<Entity | null>;
  deleteEntity(id: string): Promise<void>;

  // Edge
  storeEdge(edge: Edge): Promise<void>;
  getNeighbors(node: NodeRef, hops?: number): Promise<NodeRef[]>;

  // Fact
  storeFact(fact: Fact): Promise<void>;
  getFactsForEntity(entity: string, attribute?: string): Promise<Fact[]>;
  /**
   * Mark a fact as superseded by another. Updates `isLatest=false` and
   * `supersededBy=newFactId` on the old fact. The new fact must already
   * exist (created via `storeFact`); this is a pure link operation.
   * See ADR 006.
   */
  markFactSuperseded(oldFactId: string, newFactId: string): Promise<void>;

  // Contradiction
  storeContradiction(contradiction: Contradiction): Promise<void>;
  listContradictions(status?: Contradiction['status']): Promise<Contradiction[]>;

  // Insight
  storeInsight(insight: Insight): Promise<void>;
  listInsights(entityId?: string): Promise<Insight[]>;

  // EntityProfile
  storeEntityProfile(profile: EntityProfile): Promise<void>;
  getEntityProfile(entityId: string): Promise<EntityProfile | null>;

  // AgentSelf
  getAgentSelf(): Promise<AgentSelf | null>;
  updateAgentSelf(self: AgentSelf): Promise<void>;
}

export interface MemoryFilter {
  tier?: Tier;
  scopes?: Scopes;
  isPinned?: boolean;
  limit?: number;
}

/**
 * Vector index. Stores per-chunk embeddings + metadata; supports approximate
 * nearest-neighbour search.
 */
export interface VectorStore {
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  upsert(items: VectorItem[]): Promise<void>;
  query(vector: number[], opts?: VectorQueryOpts): Promise<VectorMatch[]>;
  delete(ids: string[]): Promise<void>;
}

export interface VectorItem {
  id: string;
  vector: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorQueryOpts {
  topK?: number;
  filter?: Record<string, unknown>;
}

export interface VectorMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * Text → vector embedding provider.
 */
export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

/**
 * LLM provider — used by sleep-pipeline steps (fact extraction, summarisation,
 * reasoning) and by agent chat.
 */
export interface LLMProvider {
  readonly model: string;
  complete(prompt: string, opts?: LLMCompleteOpts): Promise<string>;
}

export interface LLMCompleteOpts {
  temperature?: number;
  maxTokens?: number;
  system?: string;
}

/**
 * Optional reranker. Runs after hybrid retrieval to re-rank candidates by
 * relevance to the query. Defaults: cloud has no reranker (latency); CLI
 * surfaces typically enable a Haiku reranker.
 */
export interface RerankerProvider {
  readonly model: string;
  rerank<T extends { text: string }>(
    query: string,
    candidates: T[],
    opts?: { topK?: number },
  ): Promise<T[]>;
}

/**
 * Scheduler — triggers periodic work (most importantly, the sleep pipeline).
 */
export interface Scheduler {
  schedule(
    jobName: string,
    intervalMs: number,
    handler: () => Promise<void>,
  ): Promise<void>;
  cancel(jobName: string): Promise<void>;
  now(): Date;
}

/**
 * Job queue — enqueues async work units. Real implementations may serialise
 * (in-process Promise chain) or distribute (BullMQ + Redis).
 */
export interface JobQueue {
  enqueue<T>(name: string, payload: T): Promise<string>;
  process<T>(name: string, handler: (payload: T) => Promise<void>): void;
}
