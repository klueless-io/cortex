import { randomUUID } from 'node:crypto';
import {
  ContradictionSchema,
  FactSchema,
  MemorySchema,
  type Contradiction,
  type ContradictionStatus,
  type Fact,
  type Memory,
  type Tier,
  type NodeRef,
  type Entity,
  type Edge,
  type Scopes,
  type FactSourceType,
  type FactCategory,
  type StructuredStore,
  type VectorStore,
  type Logger,
} from '@kybernesis/arcana-contracts';
import { NotImplementedError } from '../../errors.js';
import { djb2Hash } from '../../util/hash.js';

/**
 * Input for `command.recordFact`. Mirrors the v1.0.0 `Fact` schema (ADR 013):
 * - `fact` (sentence form) is required.
 * - `entities` (denormalised list of entity names this fact mentions) — at
 *   least one entity required.
 * - `category` defaults to `'general'` when omitted (matches KB extractor
 *   convention).
 * - `attribute` and `value` (triple decomposition) remain optional per
 *   ADR 004.
 * - `sourceMemoryId` / `sourcePath` / `sourceConversationId` are backlinks
 *   for provenance + Layer-0 fact-FTS fan-out.
 */
export interface RecordFactInput {
  fact: string;
  entities: string[];
  attribute?: string;
  value?: string;
  confidence: number;
  sourceType: FactSourceType;
  /** Defaults to 'general' when omitted. */
  category?: FactCategory;
  sourceMemoryId?: string;
  sourcePath?: string;
  sourceConversationId?: string;
  expiresAt?: string;
  scopes?: Scopes;
}

/**
 * Input for `command.storeContradiction`. Kernel mints `id` + `createdAt`.
 * `status` defaults to `'pending'` when omitted. `rationale` captures the
 * detection-time explanation (typically LLM-extracted) and is optional;
 * `resolution` is reserved for the resolve flow (out of scope for create).
 * See ADR 006.
 */
export interface StoreContradictionInput {
  factAId: string;
  factBId: string;
  status?: ContradictionStatus;
  rationale?: string;
}

export interface LinkNodesOptions {
  /** 0..1 confidence in the relation. Defaults to 1.0. */
  confidence?: number;
  /** Tags shared between the two nodes (drives some retrieval scoring). */
  sharedTags?: string[];
  /** How this edge was produced (jaccard | llm-derived | manual | consumer-mirror | ...). Defaults to 'consumer-mirror'. */
  method?: string;
  /** Optional human-readable justification. */
  rationale?: string;
}

/**
 * Public shape for `command.updateMemory`. Excludes `id` (immutable) and
 * `contentHash` (kernel-derived from content). Supplying `content` triggers
 * automatic contentHash recomputation; consumers don't think about hashes.
 *
 * `scopes` replaces (not merges) the existing scopes object. See ADR 005.
 */
export type UpdateMemoryFields = Partial<Omit<Memory, 'id' | 'contentHash'>>;

export interface CommandDeps {
  structured: StructuredStore;
  vector: VectorStore;
  logger: Logger;
}

export interface CommandApi {
  /** Upsert an entity (insert or replace by id). */
  upsertEntity(entity: Entity): Promise<void>;
  /** Delete an entity by id. */
  deleteEntity(id: string): Promise<void>;
  /**
   * Record a fact. `fact` (sentence form) and `entity` are required;
   * `attribute`/`value` triple decomposition is optional. See ADR 004.
   */
  recordFact(input: RecordFactInput): Promise<string>;
  /**
   * Mark an existing fact as superseded by another. Pure link operation:
   * updates `isLatest=false` and `supersededBy=newFactId` on the old fact.
   * The new fact must already exist (typically created via `recordFact`).
   * See ADR 006.
   */
  markFactSuperseded(oldFactId: string, newFactId: string): Promise<void>;
  /**
   * Mark an existing memory as superseded by another. Pure link operation:
   * updates `isLatest=false` and `supersededBy=newMemoryId` on the old memory.
   * The new memory must already exist (typically created via `ingest.storeMemory`).
   * Mirrors `markFactSuperseded`. See ADR 007 §3.2.
   */
  markMemorySuperseded(oldMemoryId: string, newMemoryId: string): Promise<void>;
  /**
   * Store a contradiction between two facts. Kernel mints id + createdAt;
   * status defaults to `'pending'`. `rationale` captures the why-detected
   * signal (e.g., LLM-extracted explanation). Returns the new contradiction id.
   * See ADR 006.
   */
  storeContradiction(input: StoreContradictionInput): Promise<string>;
  /**
   * Create a typed edge between two nodes (memory↔memory, memory↔entity,
   * or entity↔entity). Returns the edge id.
   */
  linkNodes(
    from: NodeRef,
    to: NodeRef,
    relation: string,
    opts?: LinkNodesOptions,
  ): Promise<string>;
  /**
   * Partial in-place update of a Memory. Only supplied fields change.
   * `contentHash` is recomputed automatically when `content` is provided.
   * `scopes` replaces (not merges) the previous scopes object.
   *
   * See ADR 005 — Memory was never append-only by design; this primitive
   * unblocks pin / moveToTier and lets consumers update tracked fields
   * (accessCount, decayScore, tier, content) without orphaning records.
   */
  updateMemory(id: string, fields: UpdateMemoryFields): Promise<void>;
  /** Pin a memory so decay/tier transitions skip it. */
  pin(memoryId: string): Promise<void>;
  /** Force-move a memory to a specific tier. */
  moveToTier(memoryId: string, tier: Tier): Promise<void>;
  /** Permanently delete a memory and its associated chunks/edges/facts. */
  deleteMemory(id: string): Promise<void>;
  /** Update one of the agent's own memory blocks. */
  updateBlock(label: string, content: string, changedBy?: string): Promise<void>;
}

export function createCommand(deps: CommandDeps): CommandApi {
  const stub = (method: string): never => {
    throw new NotImplementedError(
      `arcana-core/access.command.${method} is a v0.1 scaffold stub; real implementation lands in v0.x`,
    );
  };

  const PUBLIC_UPDATE_SCHEMA = MemorySchema.omit({
    id: true,
    contentHash: true,
  })
    .partial()
    .strict();

  const updateMemory = async (
    id: string,
    fields: UpdateMemoryFields,
  ): Promise<void> => {
    const validated = PUBLIC_UPDATE_SCHEMA.parse(fields);
    // If content changed, the kernel recomputes contentHash. Consumers
    // never set contentHash directly.
    const providerFields: Partial<Omit<Memory, 'id'>> =
      validated.content !== undefined
        ? { ...validated, contentHash: djb2Hash(validated.content) }
        : validated;
    await deps.structured.updateMemory(id, providerFields);
    deps.logger.debug('arcana.command.updateMemory', {
      id,
      fieldKeys: Object.keys(validated),
      contentChanged: validated.content !== undefined,
    });
  };

  return {
    upsertEntity: async (entity: Entity) => {
      await deps.structured.upsertEntity(entity);
      deps.logger.debug('arcana.command.upsertEntity', {
        id: entity.id,
        name: entity.name,
      });
    },

    deleteEntity: async (id: string) => {
      await deps.structured.deleteEntity(id);
      deps.logger.debug('arcana.command.deleteEntity', { id });
    },

    recordFact: async (input: RecordFactInput): Promise<string> => {
      // v1.2.0 — entities normalised at storage: lowercase + trim. Empty
      // strings dropped. FactSchema enforces min(1) entity at validate time.
      const normalisedEntities = input.entities
        .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
        .filter((e) => e.length > 0);
      const candidate: Fact = {
        id: randomUUID(),
        fact: input.fact,
        entities: normalisedEntities,
        attribute: input.attribute,
        value: input.value,
        confidence: input.confidence,
        sourceType: input.sourceType,
        sourceMemoryId: input.sourceMemoryId,
        sourcePath: input.sourcePath,
        sourceConversationId: input.sourceConversationId,
        category: input.category ?? 'general',
        createdAt: new Date().toISOString(),
        isLatest: true,
        expiresAt: input.expiresAt,
        scopes: input.scopes,
      };
      const validated = FactSchema.parse(candidate);
      await deps.structured.storeFact(validated);
      deps.logger.debug('arcana.command.recordFact', {
        id: validated.id,
        entities: validated.entities,
        category: validated.category,
        hasTripleDecomposition:
          validated.attribute !== undefined && validated.value !== undefined,
      });
      return validated.id;
    },

    linkNodes: async (
      from: NodeRef,
      to: NodeRef,
      relation: string,
      opts?: LinkNodesOptions,
    ): Promise<string> => {
      const edge: Edge = {
        id: randomUUID(),
        from,
        to,
        relation,
        confidence: opts?.confidence ?? 1.0,
        sharedTags: opts?.sharedTags ?? [],
        rationale: opts?.rationale,
        method: opts?.method ?? 'consumer-mirror',
        createdAt: new Date().toISOString(),
      };
      await deps.structured.storeEdge(edge);
      deps.logger.debug('arcana.command.linkNodes', {
        id: edge.id,
        relation,
        from: `${from.type}:${from.id}`,
        to: `${to.type}:${to.id}`,
      });
      return edge.id;
    },

    updateMemory,

    pin: async (memoryId: string): Promise<void> => {
      await updateMemory(memoryId, { isPinned: true });
    },

    moveToTier: async (memoryId: string, tier: Tier): Promise<void> => {
      await updateMemory(memoryId, { tier });
    },

    markFactSuperseded: async (
      oldFactId: string,
      newFactId: string,
    ): Promise<void> => {
      await deps.structured.markFactSuperseded(oldFactId, newFactId);
      deps.logger.debug('arcana.command.markFactSuperseded', {
        oldFactId,
        newFactId,
      });
    },

    markMemorySuperseded: async (
      oldMemoryId: string,
      newMemoryId: string,
    ): Promise<void> => {
      await deps.structured.markMemorySuperseded(oldMemoryId, newMemoryId);
      deps.logger.debug('arcana.command.markMemorySuperseded', {
        oldMemoryId,
        newMemoryId,
      });
    },

    storeContradiction: async (
      input: StoreContradictionInput,
    ): Promise<string> => {
      const candidate: Contradiction = {
        id: randomUUID(),
        factAId: input.factAId,
        factBId: input.factBId,
        status: input.status ?? 'pending',
        rationale: input.rationale,
        createdAt: new Date().toISOString(),
      };
      const validated = ContradictionSchema.parse(candidate);
      await deps.structured.storeContradiction(validated);
      deps.logger.debug('arcana.command.storeContradiction', {
        id: validated.id,
        factAId: validated.factAId,
        factBId: validated.factBId,
        status: validated.status,
        hasRationale: validated.rationale !== undefined,
      });
      return validated.id;
    },

    deleteMemory: async () => stub('deleteMemory'),
    updateBlock: async () => stub('updateBlock'),
  };
}
