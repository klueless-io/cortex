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
export interface HybridSearchInput {
  query: string;
  scopes?: Scopes;
  tier?: Tier;
  topK?: number;
  /**
   * @deprecated Since v0.4.0 (ADR 011 — port-first principle). Accepted for
   * shape stability but silently ignored at runtime; the graph-BFS retrieval
   * channel will return as v2 hybridSearch after parity is proven.
   */
  graphHops?: number;
  rerank?: boolean;
}

/**
 * Result shape — KyberBot-faithful (v0.4.0 rebase per ADR 011). Three channels
 * collapse onto two exposed score fields: `semanticScore` carries the semantic
 * channel's RRF contribution; `keywordScore` collapses the keyword (FTS),
 * temporal, and entity-name-filter channels' contributions. `matchType` is
 * `'semantic' | 'keyword' | 'both'` mirroring KyberBot's vocabulary.
 *
 * `graphScore` is retained as a deprecated zero-emitting field for shape
 * stability — graph-BFS retrieval returns in a future v2 hybridSearch.
 */
export interface HybridSearchResult {
  memory: Memory;
  /** Fused RRF score across all channels this memory appears in. */
  score: number;
  /** Semantic channel RRF contribution. 0 when absent from this channel. */
  semanticScore: number;
  /** Collapsed RRF contribution from keyword + temporal + entity channels. 0 when absent. */
  keywordScore: number;
  /** @deprecated Since v0.4.0. Always 0; graph-BFS retrieval returns in v2. */
  graphScore: number;
  matchType: 'semantic' | 'keyword' | 'both';
  why?: string;
}

/** RRF smoothing constant (de-facto standard; matches KyberBot hybrid-search.ts:70). */
const RRF_K = 60;

/** Reciprocal Rank Fusion contribution for an item at zero-based rank. */
function rrfContribution(rank: number): number {
  return 1 / (RRF_K + rank + 1);
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
    async hybridSearch(
      input: HybridSearchInput,
    ): Promise<QueryResult<HybridSearchResult[]>> {
      const topK = input.topK ?? 10;
      // `graphHops` is deprecated since v0.4.0 (ADR 011). Accepted for shape
      // stability; intentionally not destructured. Graph-BFS retrieval returns
      // in v2 hybridSearch.
      const channelTopK = topK * 3;

      let keywordIds: string[] = [];
      let semanticIds: string[] = [];
      let temporalIds: string[] = [];
      let entityIds: string[] = [];

      // ── Keyword channel (FTS via StructuredStore.searchFulltext) ─────
      let keywordMemories: Memory[] = [];
      try {
        const matches = await deps.structured.searchFulltext(input.query, {
          scopes: input.scopes,
          tier: input.tier,
          topK: channelTopK,
        });
        keywordIds = matches.map((m) => m.memoryId);
        // Fetch memories once; reused by the temporal channel.
        const fetched = await Promise.all(
          keywordIds.map((id) => deps.structured.getMemory(id)),
        );
        keywordMemories = fetched.filter((m): m is Memory => m !== null);
      } catch (err) {
        deps.logger.debug('arcana.retrieve.hybridSearch.keyword-channel-failed', {
          error: (err as Error).message,
        });
      }

      // ── Semantic channel (vector via EmbeddingProvider + VectorStore) ─
      try {
        const embedding = await deps.embed.embed(input.query);
        const vectorMatches = await deps.vector.query(embedding, {
          topK: channelTopK,
        });
        const ids: string[] = [];
        for (const m of vectorMatches) {
          const memId =
            (m.metadata?.memoryId as string | undefined) ??
            (m.metadata?.memory_id as string | undefined);
          if (memId && !ids.includes(memId)) ids.push(memId);
        }
        semanticIds = ids;
      } catch (err) {
        deps.logger.debug('arcana.retrieve.hybridSearch.semantic-channel-failed', {
          error: (err as Error).message,
        });
      }

      // ── Temporal channel (same memories as keyword, ordered by createdAt DESC) ─
      // KyberBot-faithful: temporal results are FTS keyword matches re-sorted
      // by recency. Same memory ids, different RRF rank positions, contributing
      // a second RRF vote to recent matches.
      try {
        temporalIds = [...keywordMemories]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((m) => m.id)
          .slice(0, channelTopK);
      } catch (err) {
        deps.logger.debug('arcana.retrieve.hybridSearch.temporal-channel-failed', {
          error: (err as Error).message,
        });
      }

      // ── Entity-name-filter channel ───────────────────────────────────
      // Tokenize the query; for each token, find entities whose name contains
      // it; collect memory ids linked to those entities via the edges graph.
      try {
        const tokens = input.query
          .toLowerCase()
          .split(/\s+/)
          .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
          .filter((t) => t.length >= 3);

        const seen = new Set<string>();
        for (const token of tokens) {
          const entities = await deps.structured.listEntities({
            nameContains: token,
            scopes: input.scopes,
            limit: 20,
          });
          for (const e of entities) {
            const neighbors = await deps.structured.getNeighbors({
              type: 'entity',
              id: e.id,
            });
            for (const n of neighbors) {
              if (n.type !== 'memory') continue;
              if (seen.has(n.id)) continue;
              seen.add(n.id);
              entityIds.push(n.id);
            }
          }
        }
        entityIds = entityIds.slice(0, channelTopK);
      } catch (err) {
        deps.logger.debug('arcana.retrieve.hybridSearch.entity-channel-failed', {
          error: (err as Error).message,
        });
      }

      // ── RRF fusion (4 channels, but exposed as 2 score fields per KB) ──
      // KyberBot collapses keyword + temporal + entity contributions into a
      // single `keywordScore` field (KB hybrid-search.ts:471–472). Semantic
      // stays separate. `score` is the sum of all channel contributions.
      type Fused = {
        memoryId: string;
        score: number;
        semanticScore: number;
        keywordScore: number;
      };
      const fused = new Map<string, Fused>();

      const addChannel = (
        ids: string[],
        bucket: 'semantic' | 'keyword',
      ): void => {
        ids.forEach((id, rank) => {
          const contribution = rrfContribution(rank);
          const existing = fused.get(id) ?? {
            memoryId: id,
            score: 0,
            semanticScore: 0,
            keywordScore: 0,
          };
          existing.score += contribution;
          if (bucket === 'semantic') {
            // semantic channel exclusive
            existing.semanticScore = Math.max(existing.semanticScore, contribution);
          } else {
            // keyword bucket: keyword + temporal + entity all funnel here
            existing.keywordScore = Math.max(existing.keywordScore, contribution);
          }
          fused.set(id, existing);
        });
      };
      addChannel(keywordIds, 'keyword');
      addChannel(semanticIds, 'semantic');
      addChannel(temporalIds, 'keyword');
      addChannel(entityIds, 'keyword');

      const ranked = [...fused.values()].sort((a, b) => b.score - a.score).slice(0, topK);

      // ── Enrich to Memory + assign matchType ──────────────────────────
      const enriched: HybridSearchResult[] = [];
      for (const f of ranked) {
        const memory = await deps.structured.getMemory(f.memoryId);
        if (!memory) continue;
        const inSemantic = f.semanticScore > 0;
        const inKeywordBucket = f.keywordScore > 0;
        const matchType: HybridSearchResult['matchType'] =
          inSemantic && inKeywordBucket
            ? 'both'
            : inSemantic
              ? 'semantic'
              : 'keyword';
        enriched.push({
          memory,
          score: f.score,
          semanticScore: f.semanticScore,
          keywordScore: f.keywordScore,
          graphScore: 0,
          matchType,
        });
      }

      // ── Optional reranker ────────────────────────────────────────────
      if (input.rerank && deps.reranker) {
        try {
          const reranked = await deps.reranker.rerank(
            input.query,
            enriched.map((r) => ({ ...r, text: r.memory.content })),
            { topK },
          );
          deps.logger.debug('arcana.retrieve.hybridSearch.reranked', { count: reranked.length });
          return makeEnvelope(reranked.map(({ text: _ignored, ...rest }) => rest));
        } catch (err) {
          deps.logger.debug('arcana.retrieve.hybridSearch.rerank-failed', {
            error: (err as Error).message,
          });
        }
      }

      return makeEnvelope(enriched);
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
      // ────────────────────────────────────────────────────────────────────────
      // KyberBot-faithful 4-layer port per ADR 011 (v0.4.1 rebase).
      // Source: kyberbot/packages/cli/src/brain/fact-retrieval.ts
      //
      // KB algorithm structure: Layer 1 direct FTS → Layer 2 entity-name
      // expansion (1-hop) → Layer 3 graph expansion (further entity hops)
      // → Layer 4 bridge (memories connecting multiple matched entities).
      //
      // Schema-translation choices (documented in
      // docs/plans/2026-05-21-fact-retrieval-rebase.md Findings appendix):
      //   - KB has a richer `facts` table (category, source_path, entities_json,
      //     fact-level FTS5). Arcana's Fact schema is lighter and facts don't
      //     directly link to memories. So we operate the *algorithm* against
      //     Arcana's memory + entity + edge tables, with facts contributing
      //     as a ranking signal via getFactsForEntity.
      //   - KB returns a richer bundle (facts + supporting_context +
      //     assembled_context). Arcana's contract returns memory-shaped
      //     HybridSearchResult[]; the layer algorithm produces memory ranks,
      //     not fact-shaped output. Rich-bundle return is v2 work.
      // ────────────────────────────────────────────────────────────────────────

      // Hop-distance penalties (KB hybrid-search.ts:333-338)
      const HOP_PENALTY: Record<number, number> = { 0: 1.0, 1: 0.7, 2: 0.5, 3: 0.3 };

      // Tokenize query (KB pattern: length ≥ 3, strip punctuation)
      const tokens = input.query
        .toLowerCase()
        .replace(/[?.,!'"]/g, '')
        .split(/\s+/)
        .filter((w) => w.length >= 3);

      const topK = input.tokenBudget ? Math.floor(input.tokenBudget / 200) : 10;

      // Per-memory accumulator: max score across layers; source label tracks
      // the highest-priority layer that fired for this memory (regardless of
      // relative score), because bridge > direct > entity_expansion >
      // graph_expansion as a semantic-strength ordering.
      type Source = 'direct' | 'entity_expansion' | 'graph_expansion' | 'bridge';
      type Scored = { memoryId: string; score: number; source: Source };
      const scored = new Map<string, Scored>();

      const LAYER_PRIORITY: Record<Source, number> = {
        bridge: 4,
        direct: 3,
        entity_expansion: 2,
        graph_expansion: 1,
      };

      const bump = (memoryId: string, score: number, source: Source): void => {
        const existing = scored.get(memoryId);
        if (!existing) {
          scored.set(memoryId, { memoryId, score, source });
          return;
        }
        if (score > existing.score) existing.score = score;
        if (LAYER_PRIORITY[source] > LAYER_PRIORITY[existing.source]) {
          existing.source = source;
        }
      };

      // ── Layer 1: direct FTS over memories (KB fact-retrieval.ts:113-280) ──
      // KB does FTS over the facts table; Arcana does FTS over memories
      // (no fact-level FTS5 yet; that's v2 schema work). The algorithm
      // shape — keyword match → word-match-ratio scoring → 0.5-1.0 range —
      // is preserved.
      if (tokens.length > 0) {
        try {
          const matches = await deps.structured.searchFulltext(input.query, {
            scopes: input.scopes,
            topK: topK * 3,
          });
          for (const m of matches) {
            // KB scoring (line 162-165): 0.5 + (matchRatio * 0.5)
            bump(m.memoryId, 0.5 + m.score * 0.5, 'direct');
          }
        } catch (err) {
          deps.logger.debug('arcana.retrieve.factRetrieval.layer1-failed', {
            error: (err as Error).message,
          });
        }
      }

      // ── Layer 2: entity-name match → entity's facts → linked memories ──
      // KB fact-retrieval.ts:346-448. Seed entities from query-name match;
      // hop-0 entities get score 1.0; their associated memories are surfaced.
      const seedEntityIds: string[] = [];
      try {
        for (const token of tokens) {
          const entities = await deps.structured.listEntities({
            nameContains: token,
            scopes: input.scopes,
            limit: 5,
          });
          for (const e of entities) {
            if (!seedEntityIds.includes(e.id)) seedEntityIds.push(e.id);
            const neighbors = await deps.structured.getNeighbors({
              type: 'entity',
              id: e.id,
            });
            for (const n of neighbors) {
              if (n.type !== 'memory') continue;
              // hop-0 entities → max score per KB pattern (line 427)
              bump(n.id, 1.0 * HOP_PENALTY[0], 'entity_expansion');
            }
          }
        }
      } catch (err) {
        deps.logger.debug('arcana.retrieve.factRetrieval.layer2-failed', {
          error: (err as Error).message,
        });
      }

      // ── Layer 3: graph traversal — 1-hop from seed entities ─────────────
      // KB fact-retrieval.ts:291-329 (traverseEntityGraph, maxHops=1 per
      // line 373's precision tuning). Score is confidence × hop penalty.
      try {
        for (const seedId of seedEntityIds) {
          const seedNeighbors = await deps.structured.getNeighbors({
            type: 'entity',
            id: seedId,
          });
          // Walk to neighboring entities (hop 1)
          for (const nbr of seedNeighbors) {
            if (nbr.type !== 'entity') continue;
            if (seedEntityIds.includes(nbr.id)) continue; // already covered by layer 2
            // For each hop-1 entity, surface its memories with hop penalty
            const memoryNeighbors = await deps.structured.getNeighbors({
              type: 'entity',
              id: nbr.id,
            });
            for (const mn of memoryNeighbors) {
              if (mn.type !== 'memory') continue;
              // KB pattern (line 427): non-seed gets ef.confidence × penalty.
              // Without per-fact confidence here, use default 0.7 baseline.
              bump(mn.id, 0.7 * HOP_PENALTY[1], 'graph_expansion');
            }
          }
        }
      } catch (err) {
        deps.logger.debug('arcana.retrieve.factRetrieval.layer3-failed', {
          error: (err as Error).message,
        });
      }

      // ── Layer 4: bridge — memories linked to ≥ 2 seed entities ──────────
      // KB fact-retrieval.ts has scene/bridge expansion that surfaces
      // facts connecting distinct entity clusters. The Arcana equivalent:
      // memories that appear in the neighbors of ≥ 2 distinct seed entities
      // get a bridge boost (these are connective hubs across the query's
      // entity span).
      if (seedEntityIds.length >= 2) {
        try {
          const memoryToSeedCount = new Map<string, number>();
          for (const seedId of seedEntityIds) {
            const neighbors = await deps.structured.getNeighbors({
              type: 'entity',
              id: seedId,
            });
            for (const n of neighbors) {
              if (n.type !== 'memory') continue;
              memoryToSeedCount.set(n.id, (memoryToSeedCount.get(n.id) ?? 0) + 1);
            }
          }
          for (const [memoryId, count] of memoryToSeedCount) {
            if (count >= 2) {
              // Bridge memories represent stronger evidence than any single
              // entity match — baseline > Layer 2's max (1.0) so bridges
              // outrank single-entity matches in the final sort.
              bump(memoryId, 1.05 + Math.min(count - 2, 5) * 0.03, 'bridge');
            }
          }
        } catch (err) {
          deps.logger.debug('arcana.retrieve.factRetrieval.layer4-failed', {
            error: (err as Error).message,
          });
        }
      }

      // ── Fusion + enrichment ─────────────────────────────────────────────
      const ranked = [...scored.values()].sort((a, b) => b.score - a.score).slice(0, topK);

      const results: HybridSearchResult[] = [];
      for (const s of ranked) {
        const memory = await deps.structured.getMemory(s.memoryId);
        if (!memory) continue;
        // Filter to active + isLatest (preserve prior behaviour)
        if (memory.status !== 'active' || memory.isLatest !== true) continue;
        results.push({
          memory,
          score: s.score,
          keywordScore: s.source === 'direct' ? s.score : 0,
          semanticScore: 0,
          graphScore: 0,
          matchType: 'keyword',
          why: `fact-retrieval/${s.source}`,
        });
      }

      return makeEnvelope(results);
    },
  };
}
