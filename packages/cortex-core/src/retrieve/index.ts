import type {
  Memory,
  Fact,
  FactCategory,
  EntityProfile,
  Scopes,
  Tier,
  StructuredStore,
  VectorStore,
  EmbeddingProvider,
  RerankerProvider,
  Logger,
  QueryResult,
} from '@kybernesis/cortex-contracts';
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
  /** v1.0.0 — filter Layer 0 fact-FTS to a single category. */
  category?: FactCategory;
}

/**
 * v1.0.0 — fact bundle from KB `fact-retrieval.ts:31-59` (`FactSearchResult`).
 * Per ADR 013.
 */
export interface ScoredFact {
  fact: Fact;
  score: number;
  /** Which retrieval layer surfaced this fact. */
  source: 'direct_facts' | 'entity_expansion' | 'graph_expansion' | 'bridge';
}

export interface FactRetrievalResult {
  /** Direct fact hits — Layer 0 (fact-FTS) + entity-derived facts. */
  facts: ScoredFact[];
  /** Memory-shaped results from the 4 memory layers. */
  supportingMemories: HybridSearchResult[];
  /** Token-budgeted concatenation of facts + supporting memories, prompt-ready. */
  assembledContext: string;
  /** Rough token count — `Math.ceil(assembledContext.length / 4)` (KB convention). */
  tokenEstimate: number;
  stats: {
    perLayerCounts: Record<string, number>;
    totalCandidates: number;
    deduplicatedCount: number;
  };
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
  /**
   * Multi-stage fact-aware retrieval. v1.0.0: 5-layer flow per ADR 013 —
   * Layer 0 direct fact-FTS, then memory layers 1-4 (direct memory FTS,
   * entity-name expansion, 1-hop graph, bridge). Returns a rich
   * `FactRetrievalResult` bundle ported from KyberBot's empirical shape.
   */
  factRetrieval(input: FactRetrievalInput): Promise<QueryResult<FactRetrievalResult>>;
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
        deps.logger.debug('cortex.retrieve.hybridSearch.keyword-channel-failed', {
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
        deps.logger.debug('cortex.retrieve.hybridSearch.semantic-channel-failed', {
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
        deps.logger.debug('cortex.retrieve.hybridSearch.temporal-channel-failed', {
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
        deps.logger.debug('cortex.retrieve.hybridSearch.entity-channel-failed', {
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
          deps.logger.debug('cortex.retrieve.hybridSearch.reranked', { count: reranked.length });
          return makeEnvelope(reranked.map(({ text: _ignored, ...rest }) => rest));
        } catch (err) {
          deps.logger.debug('cortex.retrieve.hybridSearch.rerank-failed', {
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
    ): Promise<QueryResult<FactRetrievalResult>> {
      // ────────────────────────────────────────────────────────────────────────
      // v1.0.0 — 5-layer KyberBot-faithful port per ADR 011 + ADR 013.
      // Source: kyberbot/packages/cli/src/brain/fact-retrieval.ts (994 LOC)
      //
      // Layer 0 — direct fact-FTS via searchFactsFulltext (NEW in v1.0.0).
      // Layer 1 — direct memory FTS.
      // Layer 2 — entity-name expansion (also surfaces entity-attached facts).
      // Layer 3 — 1-hop graph expansion.
      // Layer 4 — bridge (memories connecting ≥ 2 seed entities).
      //
      // Memory source-layer priority: bridge > direct > entity_expansion > graph_expansion.
      // Fact source-layer priority: bridge > direct_facts > entity_expansion > graph_expansion.
      //
      // Returns the rich bundle from KB fact-retrieval.ts:31-59 (FactSearchResult):
      // facts (Layer 0 + entity-derived), supportingMemories (Layers 1-4),
      // assembledContext (prompt-ready), tokenEstimate (length/4), stats.
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

      // Per-memory accumulator: max score; source label tracks highest-priority
      // layer regardless of relative score.
      type MemorySource = 'direct' | 'entity_expansion' | 'graph_expansion' | 'bridge';
      type ScoredMemory = { memoryId: string; score: number; source: MemorySource };
      const scored = new Map<string, ScoredMemory>();

      const MEMORY_PRIORITY: Record<MemorySource, number> = {
        bridge: 4,
        direct: 3,
        entity_expansion: 2,
        graph_expansion: 1,
      };

      const bump = (memoryId: string, score: number, source: MemorySource): void => {
        const existing = scored.get(memoryId);
        if (!existing) {
          scored.set(memoryId, { memoryId, score, source });
          return;
        }
        if (score > existing.score) existing.score = score;
        if (MEMORY_PRIORITY[source] > MEMORY_PRIORITY[existing.source]) {
          existing.source = source;
        }
      };

      // Per-fact accumulator (parallel to memory accumulator).
      type FactLayer = 'direct_facts' | 'entity_expansion' | 'graph_expansion' | 'bridge';
      type ScoredFactRef = { factId: string; score: number; source: FactLayer };
      const factHits = new Map<string, ScoredFactRef>();
      const FACT_PRIORITY: Record<FactLayer, number> = {
        bridge: 4,
        direct_facts: 3,
        entity_expansion: 2,
        graph_expansion: 1,
      };
      const bumpFact = (factId: string, score: number, source: FactLayer): void => {
        const existing = factHits.get(factId);
        if (!existing) {
          factHits.set(factId, { factId, score, source });
          return;
        }
        if (score > existing.score) existing.score = score;
        if (FACT_PRIORITY[source] > FACT_PRIORITY[existing.source]) {
          existing.source = source;
        }
      };

      const perLayerCounts: Record<string, number> = {
        fact_direct_facts: 0,
        memory_direct: 0,
        entity_expansion: 0,
        graph_expansion: 0,
        bridge: 0,
      };

      // ── Layer 0: direct fact-FTS (v1.0.0 — KB fact-retrieval.ts:113-280) ──
      // Direct hits on the facts_fts index. Scored by **content-only**
      // word-match-ratio per KB convention (fact-retrieval.ts:159-178):
      //
      //   wordMatchRatio = (query tokens present in fact.content) / total tokens
      //   score = 0.5 + wordMatchRatio * 0.5
      //
      // v1.2.1 fix per ADR 011: the prior BM25-derived score gave entity-only
      // matches an unfair boost (BM25 favours short haystacks → entities
      // column wins over content). Switching to content-only ratio makes
      // Cortex Layer 0 score-identical to KB's `searchFactsDirect`.
      // The FTS5 MATCH still considers both columns for *inclusion*; only
      // the *score* is content-only.
      if (tokens.length > 0) {
        try {
          const factMatches = await deps.structured.searchFactsFulltext(input.query, {
            scopes: input.scopes,
            topK: topK * 3,
            category: input.category,
          });
          for (const m of factMatches) {
            const contentLower = m.content.toLowerCase();
            const matchedTokens = tokens.filter((t) => contentLower.includes(t));
            const wordMatchRatio = matchedTokens.length / tokens.length;
            const score = 0.5 + wordMatchRatio * 0.5;
            bumpFact(m.factId, score, 'direct_facts');
            perLayerCounts.fact_direct_facts++;
          }
        } catch (err) {
          deps.logger.debug('cortex.retrieve.factRetrieval.layer0-failed', {
            error: (err as Error).message,
          });
        }
      }

      // ── Layer 1: direct FTS over memories (KB fact-retrieval.ts:113-280) ──
      // KB does FTS over the facts table; Cortex does FTS over memories
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
            perLayerCounts.memory_direct++;
          }
        } catch (err) {
          deps.logger.debug('cortex.retrieve.factRetrieval.layer1-failed', {
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
              perLayerCounts.entity_expansion++;
            }
            // Surface this entity's facts as ScoredFact hits (KB-faithful:
            // Layer 2 also produces fact hits via its fact join).
            try {
              const facts = await deps.structured.getFactsForEntity(e.name);
              for (const f of facts) {
                if (!f.isLatest) continue;
                bumpFact(f.id, 1.0 * HOP_PENALTY[0], 'entity_expansion');
              }
            } catch {
              /* swallow — fact surfacing is best-effort */
            }
          }
        }
      } catch (err) {
        deps.logger.debug('cortex.retrieve.factRetrieval.layer2-failed', {
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
              perLayerCounts.graph_expansion++;
            }
          }
        }
      } catch (err) {
        deps.logger.debug('cortex.retrieve.factRetrieval.layer3-failed', {
          error: (err as Error).message,
        });
      }

      // ── Layer 4: bridge — memories linked to ≥ 2 seed entities ──────────
      // KB fact-retrieval.ts has scene/bridge expansion that surfaces
      // facts connecting distinct entity clusters. The Cortex equivalent:
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
              perLayerCounts.bridge++;
            }
          }
        } catch (err) {
          deps.logger.debug('cortex.retrieve.factRetrieval.layer4-failed', {
            error: (err as Error).message,
          });
        }
      }

      // ── Fusion + enrichment ─────────────────────────────────────────────
      const ranked = [...scored.values()].sort((a, b) => b.score - a.score).slice(0, topK);

      const supportingMemories: HybridSearchResult[] = [];
      for (const s of ranked) {
        const memory = await deps.structured.getMemory(s.memoryId);
        if (!memory) continue;
        if (memory.status !== 'active' || memory.isLatest !== true) continue;
        supportingMemories.push({
          memory,
          score: s.score,
          keywordScore: s.source === 'direct' ? s.score : 0,
          semanticScore: 0,
          graphScore: 0,
          matchType: 'keyword',
          why: `fact-retrieval/${s.source}`,
        });
      }

      // Resolve fact ids → ScoredFact[]. KB sorts facts by score desc.
      const factEntries = [...factHits.values()].sort((a, b) => b.score - a.score);
      const facts: ScoredFact[] = [];
      const factSourceMemoryIds = new Set<string>();
      for (const hit of factEntries.slice(0, topK)) {
        const f = await deps.structured.getFact(hit.factId);
        if (!f) continue;
        facts.push({ fact: f, score: hit.score, source: hit.source });
        if (f.sourceMemoryId) factSourceMemoryIds.add(f.sourceMemoryId);
      }

      // Layer 0 fan-out: surface memories backlinked by direct-fact hits
      // when they aren't already represented in supportingMemories.
      const presentMemoryIds = new Set(supportingMemories.map((m) => m.memory.id));
      for (const memId of factSourceMemoryIds) {
        if (presentMemoryIds.has(memId)) continue;
        const memory = await deps.structured.getMemory(memId);
        if (!memory) continue;
        if (memory.status !== 'active' || memory.isLatest !== true) continue;
        supportingMemories.push({
          memory,
          score: 0.5,
          keywordScore: 0,
          semanticScore: 0,
          graphScore: 0,
          matchType: 'keyword',
          why: 'fact-retrieval/direct_facts',
        });
        presentMemoryIds.add(memId);
      }

      // Assemble context — KB fact-retrieval.ts:602-648 pattern.
      const factLines = facts.map(
        (f) => `- [${f.fact.category}] ${f.fact.fact} (confidence: ${f.fact.confidence.toFixed(2)})`,
      );
      const memoryLines = supportingMemories.map(
        (m) => `[${m.memory.createdAt}] ${m.memory.content}`,
      );
      const sections: string[] = [];
      if (factLines.length > 0) sections.push('FACTS:\n' + factLines.join('\n'));
      if (memoryLines.length > 0) sections.push('SUPPORTING CONTEXT:\n' + memoryLines.join('\n\n'));
      const assembledContext = sections.join('\n\n');
      // KB convention (fact-retrieval.ts:65-67): ~4 chars per token.
      const tokenEstimate = Math.ceil(assembledContext.length / 4);

      const totalCandidates =
        perLayerCounts.fact_direct_facts +
        perLayerCounts.memory_direct +
        perLayerCounts.entity_expansion +
        perLayerCounts.graph_expansion +
        perLayerCounts.bridge;

      const stats = {
        perLayerCounts,
        totalCandidates,
        deduplicatedCount: supportingMemories.length + facts.length,
      };

      const result: FactRetrievalResult = {
        facts,
        supportingMemories,
        assembledContext,
        tokenEstimate,
        stats,
      };
      return makeEnvelope(result);
    },
  };
}
