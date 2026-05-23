import type {
  Fact,
  Contradiction,
  Insight,
  NodeRef,
  AgentSelf,
  Scopes,
  StructuredStore,
  Logger,
  QueryResult,
} from '@kybernesis/cortex-contracts';
import { NotImplementedError } from '../../errors.js';

export interface QueryStatsResult {
  memoryCount: number;
  entityCount: number;
  factCount: number;
  contradictionCount: number;
  insightCount: number;
}

export interface QueryDeps {
  structured: StructuredStore;
  logger: Logger;
}

export interface QueryApi {
  /**
   * Look up facts for an entity. Optionally narrow by attribute.
   *
   * `asOf` (ISO 8601) narrows to facts that were valid at that instant —
   * facts with `expiresAt ≤ asOf` are excluded. Omitting `asOf` returns
   * all facts regardless of expiry (backward-compatible).
   */
  queryFacts(
    entity: string,
    attribute?: string,
    asOf?: string,
  ): Promise<QueryResult<Fact[]>>;
  /** Walk the graph N hops out from a node. */
  getNeighbors(node: NodeRef, hops?: number): Promise<QueryResult<NodeRef[]>>;
  /** Aggregate counts across the brain. */
  stats(scopes?: Scopes): Promise<QueryResult<QueryStatsResult>>;
  /** Outstanding or resolved contradictions. */
  listContradictions(status?: Contradiction['status']): Promise<QueryResult<Contradiction[]>>;
  /** Reasoning-derived insights, optionally per entity. */
  listInsights(entityId?: string): Promise<QueryResult<Insight[]>>;
  /** Read one of the agent's own memory blocks (persona, objectives, etc.). */
  readBlock(label: string): Promise<QueryResult<string | null>>;
  /** History of changes to an agent-self block. */
  getBlockHistory(label: string): Promise<QueryResult<AgentSelf['history']>>;
}

function freshEnvelope<T>(data: T): QueryResult<T> {
  return {
    data,
    generated_at: new Date().toISOString(),
    data_age_ms: 0,
    stale: false,
  };
}

export function createQuery(deps: QueryDeps): QueryApi {
  const stub = (method: string): never => {
    throw new NotImplementedError(
      `cortex-core/access.query.${method} is a v0.1 scaffold stub; real implementation lands in v0.x`,
    );
  };

  return {
    queryFacts: async (
      entity: string,
      attribute?: string,
      asOf?: string,
    ): Promise<QueryResult<Fact[]>> => {
      const facts = await deps.structured.getFactsForEntity(entity, attribute, asOf);
      deps.logger.debug('cortex.query.queryFacts', {
        entity,
        attribute,
        asOf,
        count: facts.length,
      });
      return freshEnvelope(facts);
    },

    getNeighbors: async (
      node: NodeRef,
      hops?: number,
    ): Promise<QueryResult<NodeRef[]>> => {
      const neighbors = await deps.structured.getNeighbors(node, hops);
      deps.logger.debug('cortex.query.getNeighbors', {
        nodeType: node.type,
        nodeId: node.id,
        hops,
        count: neighbors.length,
      });
      return freshEnvelope(neighbors);
    },

    listContradictions: async (
      status?: Contradiction['status'],
    ): Promise<QueryResult<Contradiction[]>> => {
      const contradictions = await deps.structured.listContradictions(status);
      deps.logger.debug('cortex.query.listContradictions', {
        status,
        count: contradictions.length,
      });
      return freshEnvelope(contradictions);
    },

    listInsights: async (
      entityId?: string,
    ): Promise<QueryResult<Insight[]>> => {
      const insights = await deps.structured.listInsights(entityId);
      deps.logger.debug('cortex.query.listInsights', {
        entityId,
        count: insights.length,
      });
      return freshEnvelope(insights);
    },

    readBlock: async (label: string): Promise<QueryResult<string | null>> => {
      const self = await deps.structured.getAgentSelf();
      const block = self?.memoryBlocks.find((b) => b.label === label);
      deps.logger.debug('cortex.query.readBlock', {
        label,
        found: Boolean(block),
      });
      return freshEnvelope(block?.content ?? null);
    },

    getBlockHistory: async (
      label: string,
    ): Promise<QueryResult<AgentSelf['history']>> => {
      const self = await deps.structured.getAgentSelf();
      const entries = (self?.history ?? []).filter((e) => e.label === label);
      deps.logger.debug('cortex.query.getBlockHistory', {
        label,
        count: entries.length,
      });
      return freshEnvelope(entries);
    },

    stats: async () => stub('stats'),
  };
}
