import type {
  Memory,
  EntityProfile,
  Scopes,
  Tier,
  StructuredStore,
  VectorStore,
  EmbeddingProvider,
  RerankerProvider,
  Logger,
  QueryResult,
} from '@kybernesis/arcana-contracts';
import { NotImplementedError } from '../errors.js';

export interface HybridSearchInput {
  query: string;
  scopes?: Scopes;
  tier?: Tier;
  topK?: number;
  graphHops?: number;
  rerank?: boolean;
}

export interface HybridSearchResult {
  memory: Memory;
  score: number;
  why?: string;
}

export interface FactRetrievalInput {
  query: string;
  depth?: number;
  scopes?: Scopes;
  tokenBudget?: number;
}

export interface RetrieveDeps {
  structured: StructuredStore;
  vector: VectorStore;
  embed: EmbeddingProvider;
  reranker?: RerankerProvider;
  logger: Logger;
}

export interface RetrieveApi {
  /** Hybrid retrieval: semantic + keyword + graph-expansion, fused via RRF. */
  hybridSearch(input: HybridSearchInput): Promise<QueryResult<HybridSearchResult[]>>;
  /** Multi-stage fact-aware retrieval: FTS → entity → graph → bridge. */
  factRetrieval(input: FactRetrievalInput): Promise<QueryResult<HybridSearchResult[]>>;
  /** Compiled dossier for an entity. */
  getEntityProfile(entityId: string): Promise<QueryResult<EntityProfile | null>>;
}

function makeEnvelope<T>(data: T): QueryResult<T> {
  return {
    data,
    generated_at: new Date().toISOString(),
    data_age_ms: 0,
    stale: false,
  };
}

export function createRetrieve(deps: RetrieveDeps): RetrieveApi {
  return {
    hybridSearch: async () => {
      throw new NotImplementedError(
        'arcana-core/retrieve.hybridSearch is a v0.1 scaffold stub; real implementation lands in v0.x',
      );
    },

    async getEntityProfile(entityId: string): Promise<QueryResult<EntityProfile | null>> {
      // 1. Check for a stored profile first
      const stored = await deps.structured.getEntityProfile(entityId);
      if (stored !== null) {
        return makeEnvelope(stored);
      }

      // 2. Assemble from live data
      const now = new Date().toISOString();

      // a. Get facts — filter to isLatest and not expired
      const allFacts = await deps.structured.getFactsForEntity(entityId);
      const liveFacts = allFacts.filter(
        (f) => f.isLatest === true && (!f.expiresAt || f.expiresAt > now),
      );

      // b. Get insights
      const insights = await deps.structured.listInsights(entityId);

      // c. Get neighbor entity IDs
      const neighbors = await deps.structured.getNeighbors({ type: 'entity', id: entityId });
      const relatedEntityIds = neighbors
        .filter((n) => n.type === 'entity')
        .map((n) => n.id);

      // If no facts and no entity data, return null
      if (liveFacts.length === 0 && insights.length === 0 && relatedEntityIds.length === 0) {
        return makeEnvelope(null);
      }

      // d. Build staticFacts from live facts
      const staticFacts = liveFacts.map((f) => ({
        value: f.fact,
        factId: f.id,
        confidence: f.confidence,
      }));

      // e. Build dynamicContext from insights
      const dynamicContext =
        insights.length > 0
          ? insights
              .slice(0, 3)
              .map((i) => i.statement)
              .join('; ')
          : '';

      // f. Mint an EntityProfile
      const profile: EntityProfile = {
        id: 'prof_' + entityId,
        entityId,
        staticFacts,
        dynamicContext,
        relatedEntityIds,
      };

      // g. Store it
      await deps.structured.storeEntityProfile(profile);

      // h. Return wrapped
      return makeEnvelope(profile);
    },

    async factRetrieval(
      input: FactRetrievalInput,
    ): Promise<QueryResult<HybridSearchResult[]>> {
      // 1. Parse query words (length > 2)
      const words = input.query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      // 2. Get all memories, filter to active + isLatest
      const allMemories = await deps.structured.listMemories();
      const activeMemories = allMemories.filter(
        (m) => m.status === 'active' && m.isLatest === true,
      );

      // 3. Score each memory
      type ScoredMemory = { memory: Memory; score: number };
      const scored: ScoredMemory[] = [];

      for (const memory of activeMemories) {
        if (words.length === 0) {
          scored.push({ memory, score: 0 });
          continue;
        }
        const haystack =
          (memory.title ?? '').toLowerCase() +
          ' ' +
          (memory.summary ?? '').toLowerCase() +
          ' ' +
          (memory.content ?? '').toLowerCase();
        const matchCount = words.filter((w) => haystack.includes(w)).length;
        const score = matchCount / words.length;
        if (score > 0) {
          scored.push({ memory, score });
        }
      }

      // 4. If depth > 0, expand matched memories via graph neighbors
      const depth = input.depth ?? 1;
      if (depth > 0 && scored.length > 0) {
        const seenIds = new Set(scored.map((s) => s.memory.id));
        const expansions: ScoredMemory[] = [];

        for (const { memory } of scored) {
          const neighbors = await deps.structured.getNeighbors({
            type: 'memory',
            id: memory.id,
          });
          for (const neighbor of neighbors) {
            if (neighbor.type === 'memory' && !seenIds.has(neighbor.id)) {
              const neighborMemory = activeMemories.find((m) => m.id === neighbor.id);
              if (neighborMemory) {
                seenIds.add(neighbor.id);
                expansions.push({ memory: neighborMemory, score: 0 });
              }
            }
          }
        }

        scored.push(...expansions);
      }

      // 5. Sort by score desc, take topK
      scored.sort((a, b) => b.score - a.score);
      const topK = input.tokenBudget ? Math.floor(input.tokenBudget / 200) : 10;
      const topResults = scored.slice(0, topK);

      // 6. Return as QueryResult<HybridSearchResult[]>
      const results: HybridSearchResult[] = topResults.map((s) => ({
        memory: s.memory,
        score: s.score,
        why: 'text-match (structured-only, no FTS5)',
      }));

      return makeEnvelope(results);
    },
  };
}
