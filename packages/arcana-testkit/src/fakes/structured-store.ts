import type {
  StructuredStore,
  Memory,
  Chunk,
  Entity,
  Edge,
  Fact,
  Contradiction,
  Insight,
  EntityProfile,
  AgentSelf,
  NodeRef,
  MemoryFilter,
} from '@kybernesisai/arcana-contracts';

/**
 * In-memory StructuredStore fake. Backed by Maps; no persistence.
 *
 * All interface methods are implemented with sensible behavior — even the
 * ones a typical test doesn't exercise — so a partial usage (e.g. only
 * storeMemory / getMemory) doesn't break TypeScript or surprise the caller
 * with a thrown error from an unrelated method.
 */
export function createFakeStructuredStore(): StructuredStore {
  const memories = new Map<string, Memory>();
  const chunksByMemory = new Map<string, Chunk[]>();
  const entities = new Map<string, Entity>();
  const edges = new Map<string, Edge>();
  const facts = new Map<string, Fact>();
  const contradictions = new Map<string, Contradiction>();
  const insights = new Map<string, Insight>();
  const entityProfiles = new Map<string, EntityProfile>();
  let agentSelf: AgentSelf | null = null;
  let connected = false;

  return {
    connect: async () => {
      connected = true;
    },
    disconnect: async () => {
      connected = false;
    },

    storeMemory: async (memory: Memory) => {
      if (!connected) throw new Error('fake StructuredStore: not connected');
      memories.set(memory.id, memory);
    },
    getMemory: async (id: string) => memories.get(id) ?? null,
    listMemories: async (filter?: MemoryFilter) => {
      let results = [...memories.values()];
      if (filter?.tier) results = results.filter((m) => m.tier === filter.tier);
      if (filter?.isPinned !== undefined) {
        results = results.filter((m) => m.isPinned === filter.isPinned);
      }
      if (filter?.scopes) {
        const wanted = filter.scopes;
        results = results.filter((m) => {
          const ms = m.scopes ?? {};
          if (wanted.org_id !== undefined && ms.org_id !== wanted.org_id) return false;
          if (wanted.project_id !== undefined && ms.project_id !== wanted.project_id) return false;
          return true;
        });
      }
      if (filter?.limit !== undefined) results = results.slice(0, filter.limit);
      return results;
    },
    deleteMemory: async (id: string) => {
      memories.delete(id);
      chunksByMemory.delete(id);
    },

    storeChunks: async (chunks: Chunk[]) => {
      for (const chunk of chunks) {
        const existing = chunksByMemory.get(chunk.memoryId) ?? [];
        existing.push(chunk);
        chunksByMemory.set(chunk.memoryId, existing);
      }
    },
    getChunksForMemory: async (memoryId: string) =>
      chunksByMemory.get(memoryId) ?? [],

    upsertEntity: async (entity: Entity) => {
      entities.set(entity.id, entity);
    },
    getEntity: async (id: string) => entities.get(id) ?? null,

    storeEdge: async (edge: Edge) => {
      edges.set(edge.id, edge);
    },
    getNeighbors: async (node: NodeRef, _hops?: number) => {
      const out: NodeRef[] = [];
      for (const edge of edges.values()) {
        if (edge.from.type === node.type && edge.from.id === node.id) out.push(edge.to);
        if (edge.to.type === node.type && edge.to.id === node.id) out.push(edge.from);
      }
      return out;
    },

    storeFact: async (fact: Fact) => {
      facts.set(fact.id, fact);
    },
    getFactsForEntity: async (entity: string, attribute?: string) => {
      return [...facts.values()].filter(
        (f) =>
          f.entity === entity &&
          (attribute === undefined || f.attribute === attribute),
      );
    },

    storeContradiction: async (contradiction: Contradiction) => {
      contradictions.set(contradiction.id, contradiction);
    },
    listContradictions: async (status?: Contradiction['status']) => {
      const all = [...contradictions.values()];
      return status === undefined ? all : all.filter((c) => c.status === status);
    },

    storeInsight: async (insight: Insight) => {
      insights.set(insight.id, insight);
    },
    listInsights: async (entityId?: string) => {
      const all = [...insights.values()];
      return entityId === undefined ? all : all.filter((i) => i.entityId === entityId);
    },

    storeEntityProfile: async (profile: EntityProfile) => {
      entityProfiles.set(profile.entityId, profile);
    },
    getEntityProfile: async (entityId: string) =>
      entityProfiles.get(entityId) ?? null,

    getAgentSelf: async () => agentSelf,
    updateAgentSelf: async (self: AgentSelf) => {
      agentSelf = self;
    },
  };
}
