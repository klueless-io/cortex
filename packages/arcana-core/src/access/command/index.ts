import { randomUUID } from 'node:crypto';
import type {
  Tier,
  NodeRef,
  Entity,
  Edge,
  StructuredStore,
  VectorStore,
  Logger,
} from '@kybernesisai/arcana-contracts';
import { NotImplementedError } from '../../errors.js';

export interface RecordFactInput {
  entity: string;
  attribute: string;
  value: string;
  confidence: number;
  sourceType: 'terminal' | 'chat' | 'ai-extraction' | 'upload' | 'connector';
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
  /** Record a fact (without going through full ingest). */
  recordFact(input: RecordFactInput): Promise<string>;
  /** Supersede an existing fact with a new value. */
  correctFact(oldFactId: string, newValue: string): Promise<string>;
  /**
   * Create a typed edge between two nodes (memory↔memory, memory↔entity,
   * or entity↔entity). Returns the edge id.
   *
   * Each call creates a new edge with a new UUID — dedup is the consumer's
   * concern (e.g., check before mirroring). At v0.1, `relation` is an
   * arbitrary string; vocabulary unification is open per arcana-spec.md §14.
   */
  linkNodes(
    from: NodeRef,
    to: NodeRef,
    relation: string,
    opts?: LinkNodesOptions,
  ): Promise<string>;
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

    recordFact: async () => stub('recordFact'),
    correctFact: async () => stub('correctFact'),
    pin: async () => stub('pin'),
    moveToTier: async () => stub('moveToTier'),
    deleteMemory: async () => stub('deleteMemory'),
    updateBlock: async () => stub('updateBlock'),
  };
}
