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
  EntityFilter,
  FulltextSearchOpts,
  FulltextMatch,
  FulltextField,
} from '@kybernesis/arcana-contracts';

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

  const store: StructuredStore = {
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
      // v1.2.0 — default latestOnly=true. Treat undefined isLatest as
      // latest (forgiving — test fixtures often omit the field).
      if (filter?.latestOnly !== false) {
        results = results.filter((m) => m.isLatest !== false);
      }
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
    updateMemory: async (id: string, fields: Partial<Omit<Memory, 'id'>>) => {
      const existing = memories.get(id);
      if (!existing) {
        throw new Error(`fake StructuredStore: updateMemory called for unknown id ${id}`);
      }
      memories.set(id, { ...existing, ...fields });
    },
    markMemorySuperseded: async (oldMemoryId: string, newMemoryId: string) => {
      const existing = memories.get(oldMemoryId);
      if (!existing) {
        throw new Error(
          `fake StructuredStore: markMemorySuperseded called for unknown id ${oldMemoryId}`,
        );
      }
      memories.set(oldMemoryId, {
        ...existing,
        isLatest: false,
        supersededBy: newMemoryId,
      });
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
    listEntities: async (filter?: EntityFilter) => {
      let results = [...entities.values()];
      if (filter?.nameContains) {
        const needle = filter.nameContains.toLowerCase();
        results = results.filter((e) => e.name.toLowerCase().includes(needle));
      }
      if (filter?.scopes) {
        const wanted = filter.scopes;
        results = results.filter((e) => {
          const es = e.scopes ?? {};
          if (wanted.org_id !== undefined && es.org_id !== wanted.org_id) return false;
          if (wanted.project_id !== undefined && es.project_id !== wanted.project_id) return false;
          return true;
        });
      }
      if (filter?.limit !== undefined) results = results.slice(0, filter.limit);
      return results;
    },
    deleteEntity: async (id: string) => {
      // v1.2.0 — cascade edges + insights + entity_profile (NOT facts).
      for (const [edgeId, edge] of edges) {
        if (
          (edge.from.type === 'entity' && edge.from.id === id) ||
          (edge.to.type === 'entity' && edge.to.id === id)
        ) {
          edges.delete(edgeId);
        }
      }
      for (const [insightId, insight] of insights) {
        if (insight.entityId === id) insights.delete(insightId);
      }
      entityProfiles.delete(id);
      entities.delete(id);
    },

    storeEdge: async (edge: Edge) => {
      edges.set(edge.id, edge);
    },
    getNeighbors: async (node: NodeRef, hops?: number) => {
      // v1.2.0 — BFS-from-seed up to `hops` levels (default 1, max 5).
      const h = hops ?? 1;
      if (h < 1 || h > 5) {
        throw new Error(`fake StructuredStore: getNeighbors hops must be 1-5 (got ${h})`);
      }
      const seen = new Set<string>();
      const seedKey = `${node.type}:${node.id}`;
      seen.add(seedKey);
      const visited = new Set<string>();
      let frontier: NodeRef[] = [node];
      const result: NodeRef[] = [];
      for (let depth = 0; depth < h && frontier.length > 0; depth++) {
        const nextFrontier: NodeRef[] = [];
        for (const cur of frontier) {
          const curKey = `${cur.type}:${cur.id}`;
          if (visited.has(curKey)) continue;
          visited.add(curKey);
          for (const edge of edges.values()) {
            let neighbor: NodeRef | null = null;
            if (edge.from.type === cur.type && edge.from.id === cur.id) {
              neighbor = edge.to;
            } else if (edge.to.type === cur.type && edge.to.id === cur.id) {
              neighbor = edge.from;
            }
            if (!neighbor) continue;
            const nKey = `${neighbor.type}:${neighbor.id}`;
            if (seen.has(nKey)) continue;
            seen.add(nKey);
            result.push(neighbor);
            nextFrontier.push(neighbor);
          }
        }
        frontier = nextFrontier;
      }
      return result;
    },

    storeFact: async (fact: Fact) => {
      facts.set(fact.id, fact);
    },
    getFact: async (id: string) => facts.get(id) ?? null,
    getFactsForEntity: async (
      entity: string,
      attribute?: string,
      asOf?: string,
      latestOnly?: boolean,
    ) => {
      // v1.2.0: entity match is case-insensitive (defense-in-depth — producers
      // normalise to lowercase at storage, but direct storeFact callers may not).
      const needle = entity.trim().toLowerCase();
      return [...facts.values()].filter((f) => {
        if (!f.entities.some((e) => e.trim().toLowerCase() === needle)) return false;
        if (attribute !== undefined && f.attribute !== attribute) return false;
        if (asOf !== undefined && f.expiresAt !== undefined && f.expiresAt <= asOf) {
          return false;
        }
        if (latestOnly !== false && f.isLatest === false) return false;
        return true;
      });
    },

    searchFactsFulltext: async (query, opts) => {
      const tokens = query.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
      if (tokens.length === 0) return [];
      const selectedFields = opts?.fields ?? (['content', 'entities'] as const);
      const latestOnly = opts?.latestOnly ?? true;
      const matches: Array<{
        factId: string;
        score: number;
        matchedFields: ('content' | 'entities')[];
      }> = [];
      for (const f of facts.values()) {
        if (latestOnly && !f.isLatest) continue;
        if (opts?.category && f.category !== opts.category) continue;
        if (opts?.scopes) {
          const fs = f.scopes ?? {};
          if (opts.scopes.org_id !== undefined && fs.org_id !== opts.scopes.org_id) continue;
          if (opts.scopes.project_id !== undefined && fs.project_id !== opts.scopes.project_id) continue;
        }
        const fieldText: Record<'content' | 'entities', string> = {
          content: f.fact.toLowerCase(),
          entities: f.entities.join(' ').toLowerCase(),
        };
        const matchedFields: ('content' | 'entities')[] = [];
        let hits = 0;
        for (const field of selectedFields) {
          const haystack = fieldText[field];
          const fieldHits = tokens.filter((t) => haystack.includes(t)).length;
          if (fieldHits > 0) {
            matchedFields.push(field);
            hits += fieldHits;
          }
        }
        if (hits === 0) continue;
        matches.push({
          factId: f.id,
          score: Math.min(1, hits / (tokens.length * selectedFields.length)),
          matchedFields,
        });
      }
      matches.sort((a, b) => b.score - a.score);
      const topK = opts?.topK ?? 50;
      return matches.slice(0, topK);
    },

    searchFulltext: async (query: string, opts?: FulltextSearchOpts): Promise<FulltextMatch[]> => {
      const tokens = query.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
      if (tokens.length === 0) return [];
      const selectedFields = (opts?.fields ?? ['title', 'summary', 'content', 'tags']) as FulltextField[];
      const matches: FulltextMatch[] = [];
      for (const m of memories.values()) {
        if (opts?.tier && m.tier !== opts.tier) continue;
        if (opts?.scopes) {
          const ms = m.scopes ?? {};
          if (opts.scopes.org_id !== undefined && ms.org_id !== opts.scopes.org_id) continue;
          if (opts.scopes.project_id !== undefined && ms.project_id !== opts.scopes.project_id) continue;
        }
        const fieldText: Record<FulltextField, string> = {
          title: m.title.toLowerCase(),
          summary: m.summary.toLowerCase(),
          content: m.content.toLowerCase(),
          tags: m.tags.join(' ').toLowerCase(),
        };
        const matchedFields: FulltextField[] = [];
        let hits = 0;
        for (const field of selectedFields) {
          const haystack = fieldText[field];
          const fieldHits = tokens.filter((t) => haystack.includes(t)).length;
          if (fieldHits > 0) {
            matchedFields.push(field);
            hits += fieldHits;
          }
        }
        if (hits === 0) continue;
        matches.push({
          memoryId: m.id,
          score: Math.min(1, hits / (tokens.length * selectedFields.length)),
          matchedFields,
        });
      }
      matches.sort((a, b) => b.score - a.score);
      const topK = opts?.topK ?? 50;
      return matches.slice(0, topK);
    },
    markFactSuperseded: async (oldFactId: string, newFactId: string) => {
      const existing = facts.get(oldFactId);
      if (!existing) {
        throw new Error(
          `fake StructuredStore: markFactSuperseded called for unknown id ${oldFactId}`,
        );
      }
      facts.set(oldFactId, {
        ...existing,
        isLatest: false,
        supersededBy: newFactId,
      });
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

    // v1.2.0 — trivial transaction: the fake is single-threaded and has no
    // BEGIN/COMMIT semantics, so we just call fn(this). This satisfies the
    // contract for tests; real providers (libsql, postgres) wrap a real
    // transaction. Note: if fn throws, no rollback — caller is responsible
    // for handling that in tests if they specifically need rollback behaviour.
    transaction: async <T>(fn: (tx: StructuredStore) => Promise<T>): Promise<T> => {
      return fn(store);
    },
  };
  return store;
}
