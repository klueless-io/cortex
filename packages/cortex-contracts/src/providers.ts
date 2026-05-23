/**
 * Provider interfaces — the pluggable adapter ring around the Cortex kernel.
 *
 * These are minimal at v0.1: just enough surface to satisfy the kernel's
 * stubbed operations and the testkit's compliance suite. Additional methods
 * will land in v0.x as the kernel's ingest/retrieve/maintain zones gain real
 * implementations. New methods are additive — never break existing signatures.
 *
 * Implementation precedent (from cortex-spec.md §3):
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
import type { Fact, Contradiction, FactCategory } from './fact.js';
import type { Insight, EntityProfile } from './insight.js';
import type { AgentSelf } from './agent-self.js';
import type { Scopes } from './scopes.js';

/**
 * Persists the structured data model. Every provider implementation must pass
 * the @kybernesis/cortex-testkit compliance suite.
 */
export interface StructuredStore {
  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /**
   * Run `fn` inside an atomic transaction. The store passed to `fn` is the
   * same StructuredStore instance — writes through it land inside the
   * transaction. If `fn` throws (or returns a rejected promise), all
   * writes roll back. If it returns normally, all writes commit.
   *
   * v1.2.0 — added per docs/SYSTEM-HEALTH.md to close the
   * storeMemory+storeChunks atomicity gap. Used by composite kernel
   * operations and by `deleteEntity`'s cascade.
   *
   * Nested transactions are NOT supported; calling `transaction` from
   * inside another `transaction` is undefined behaviour.
   */
  transaction<T>(fn: (tx: StructuredStore) => Promise<T>): Promise<T>;

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
  /**
   * Enumerate entities, optionally filtered by name substring (case-insensitive),
   * scope, or limit. Used by the entity-name-filter retrieval channel in
   * hybridSearch (KyberBot-faithful port — v0.4.0). Returning [] is valid.
   */
  listEntities(filter?: EntityFilter): Promise<Entity[]>;
  deleteEntity(id: string): Promise<void>;

  // Edge
  storeEdge(edge: Edge): Promise<void>;
  getNeighbors(node: NodeRef, hops?: number): Promise<NodeRef[]>;

  // Fact
  storeFact(fact: Fact): Promise<void>;
  /**
   * Retrieve a single fact by id, or null if it doesn't exist. v1.0.0 —
   * needed by factRetrieval's Layer 0 to resolve fact-FTS hits into the
   * rich ScoredFact bundle.
   */
  getFact(id: string): Promise<Fact | null>;
  /**
   * Look up facts for an entity. Optionally narrow by attribute.
   *
   * When `asOf` (ISO 8601) is supplied, only facts that were valid at
   * that instant are returned: facts with `expiresAt` ≤ `asOf` are
   * excluded. This is bitemporal valid-time filtering. Omitting `asOf`
   * returns all facts regardless of expiry.
   *
   * `latestOnly` (default `true`, v1.2.0) — when `true`, only facts where
   * `isLatest === true` are returned. Set to `false` to retrieve every
   * historical version (audit trails, supersession debugging).
   *
   * Entity names are matched against the lowercase normalised storage
   * form (v1.2.0); callers should not pre-lowercase but case is ignored.
   */
  getFactsForEntity(
    entity: string,
    attribute?: string,
    asOf?: string,
    latestOnly?: boolean,
  ): Promise<Fact[]>;
  /**
   * Mark a fact as superseded by another. Updates `isLatest=false` and
   * `supersededBy=newFactId` on the old fact. The new fact must already
   * exist (created via `storeFact`); this is a pure link operation.
   * See ADR 006.
   */
  markFactSuperseded(oldFactId: string, newFactId: string): Promise<void>;

  // Full-text search
  /**
   * Full-text search across memory content. Provider-specific index
   * (FTS5 for libsql, tsvector for Postgres). Returns memory IDs with
   * a normalized 0..1 relevance score and the list of fields that
   * matched. Caller (kernel) is responsible for enriching ids to full
   * Memory objects.
   *
   * Scope/tier filtering happens at this layer because the index can
   * filter rows before scoring. `fields` defaults to all indexed
   * fields when omitted.
   */
  searchFulltext(query: string, opts?: FulltextSearchOpts): Promise<FulltextMatch[]>;

  /**
   * v1.0.0 — direct full-text search over facts (not memories). Returns
   * scored fact-id matches with the indexed fields that hit. libsql uses
   * a `facts_fts` FTS5 virtual table over `content` and `entities`.
   *
   * Score is normalised to 0..1 (higher = more relevant) using the same
   * rank-based convention as `searchFulltext`.
   *
   * Per ADR 013 — this method unblocks fact-level retrieval (Layer 0 of
   * `factRetrieval`) and parity-via-swap with KyberBot's `fact-store.ts`.
   */
  searchFactsFulltext(
    query: string,
    opts?: FactsFulltextSearchOpts,
  ): Promise<FactsFulltextMatch[]>;

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
  /**
   * v1.2.0 — when `true` (default), only memories where `isLatest === true`
   * are returned. Set to `false` to include superseded versions (audit /
   * history queries).
   */
  latestOnly?: boolean;
}

export interface EntityFilter {
  /** Case-insensitive substring match on entity name. */
  nameContains?: string;
  scopes?: Scopes;
  limit?: number;
}

/** Indexed fields available for fulltext search. */
export type FulltextField = 'title' | 'summary' | 'content' | 'tags';

export interface FulltextSearchOpts {
  scopes?: Scopes;
  tier?: Tier;
  topK?: number;
  fields?: FulltextField[];
}

export interface FulltextMatch {
  memoryId: string;
  /** Normalized 0..1 — higher is more relevant. */
  score: number;
  matchedFields: FulltextField[];
}

/** Indexed fields available for fact-level fulltext search. */
export type FactsFulltextField = 'content' | 'entities';

export interface FactsFulltextSearchOpts {
  scopes?: Scopes;
  topK?: number;
  fields?: FactsFulltextField[];
  /** Filter to a single category — e.g., 'biographical'. */
  category?: FactCategory;
  /** When true (default), only return facts where isLatest = true. */
  latestOnly?: boolean;
}

export interface FactsFulltextMatch {
  factId: string;
  /** Normalized 0..1 — higher is more relevant. */
  score: number;
  matchedFields: FactsFulltextField[];
  /**
   * v1.2.1 — the fact's content string passed through from the FTS row. Used
   * by `factRetrieval` Layer 0 to compute KB-faithful word-match-ratio
   * scoring (content-only, ignoring entity matches in the score). Per ADR 011
   * port-first — KB's `fact-retrieval.ts:159-178` scores by content overlap
   * only; BM25 ranking over both columns gave entity-only matches an unfair
   * boost (see comms 2026-05-23 09:00).
   */
  content: string;
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
