import { randomUUID } from 'node:crypto';
import {
  FactSchema,
  MemorySchema,
  type Fact,
  type FactCategory,
  type Memory,
  type Scopes,
  type StructuredStore,
  type VectorStore,
  type EmbeddingProvider,
  type LLMProvider,
  type Logger,
} from '@kybernesis/arcana-contracts';
import { NotImplementedError } from '../errors.js';
import { djb2Hash } from '../util/hash.js';

/**
 * Real-time fact extraction prompt — ported verbatim from KyberBot
 * fact-extractor.ts:20-31 (`REALTIME_FACT_PROMPT`). Asks the LLM for a JSON
 * array of `{ content, category, confidence, entities }` objects.
 */
const REALTIME_FACT_PROMPT = `Extract 1-3 concrete facts about specific people, companies, or projects from this conversation. Only clear, verifiable facts — skip vague observations, greetings, and meta-commentary.

Each fact object has:
- "content": The fact statement (8-25 words, include names not pronouns)
- "category": One of: biographical, preference, event, relationship, temporal, opinion, plan, general
- "confidence": 0.5-0.9 (how confident you are)
- "entities": Array of person/entity names

Return a JSON array, or [] if no concrete facts.

Conversation:
`;

const VALID_CATEGORIES = new Set<FactCategory>([
  'biographical',
  'preference',
  'event',
  'relationship',
  'temporal',
  'opinion',
  'plan',
  'general',
]);

export interface StoreMemoryInput {
  content: string;
  title?: string;
  summary?: string;
  tags?: string[];
  source: Memory['source'];
  scopes?: Scopes;
}

export interface IngestDocumentInput {
  format: 'markdown' | 'pdf' | 'docx' | 'csv' | 'html' | 'plain';
  content: string | Uint8Array;
  filename?: string;
  scopes?: Scopes;
}

export interface IngestDeps {
  structured: StructuredStore;
  vector: VectorStore;
  embed: EmbeddingProvider;
  llm: LLMProvider;
  logger: Logger;
}

export interface IngestApi {
  /** Persist a memory and return its assigned id. */
  storeMemory(input: StoreMemoryInput): Promise<string>;
  /** Convert + chunk + ingest a document. Returns the new memory id. */
  ingestDocument(input: IngestDocumentInput): Promise<string>;
  /**
   * Extract facts from a stored memory via LLM. Ports KyberBot's real-time
   * extractor (`fact-extractor.ts:38-163`). Stores each validated fact with
   * `sourceMemoryId` backlink + `sourcePath` / `sourceConversationId`
   * threaded from memory metadata. Returns the persisted Fact[]. Never
   * throws — LLM/parse errors yield an empty array.
   */
  extractFacts(memoryId: string): Promise<Fact[]>;
}

/**
 * v0.x implementation of `storeMemory`. Scope-locked to the canonical row
 * write: build a complete Memory with defaults, validate, persist via the
 * StructuredStore, return the id.
 *
 * Deliberately NOT included at this milestone (will land when retrieval
 * actually needs them):
 * - chunking + embedding (depends on EmbeddingProvider + VectorStore)
 * - fact extraction (depends on LLMProvider)
 * - contradiction detection
 * - eager edge creation
 *
 * Those land when KyberBot's retrieval/fact code paths demand them.
 * For dual-write today (timeline.ts mirror), the canonical row write is
 * sufficient.
 */
export function createIngest(deps: IngestDeps): IngestApi {
  return {
    storeMemory: async (input: StoreMemoryInput): Promise<string> => {
      const memory: Memory = MemorySchema.parse({
        id: randomUUID(),
        title: input.title ?? '',
        summary: input.summary ?? '',
        content: input.content,
        tags: input.tags ?? [],
        priority: 0.5,
        tier: 'warm',
        decayScore: 0,
        accessCount: 0,
        createdAt: new Date().toISOString(),
        isPinned: false,
        contentHash: djb2Hash(input.content),
        source: input.source,
        status: 'active',
        isLatest: true,
        scopes: input.scopes,
      });

      // v1.2.0 — wrap in transaction so any future chunk/fact writes added
      // to this method commit atomically with the memory row. Even with just
      // the single write today, this establishes the pattern that the libsql
      // provider's transaction wrapper rolls back if anything inside fails.
      await deps.structured.transaction(async (tx) => {
        await tx.storeMemory(memory);
      });
      deps.logger.debug('arcana.ingest.storeMemory', { id: memory.id });
      return memory.id;
    },

    ingestDocument: async () => {
      throw new NotImplementedError(
        'arcana-core/ingest.ingestDocument is still a stub; lands when document ingestion is demanded by a consumer',
      );
    },

    extractFacts: async (memoryId: string): Promise<Fact[]> => {
      const memory = await deps.structured.getMemory(memoryId);
      if (!memory) {
        deps.logger.debug('arcana.ingest.extractFacts.unknown-memory', { memoryId });
        return [];
      }

      // KB guard (fact-extractor.ts:61): skip short conversations.
      if (memory.content.length < 50) {
        deps.logger.debug('arcana.ingest.extractFacts.skipped-short', { memoryId });
        return [];
      }

      // KB cap (fact-extractor.ts:71): truncate input to keep extraction fast.
      const content = memory.content.slice(0, 2000);

      let response: string;
      try {
        response = await deps.llm.complete(REALTIME_FACT_PROMPT + content, {
          maxTokens: 256,
        });
      } catch (err) {
        deps.logger.debug('arcana.ingest.extractFacts.llm-failed', {
          memoryId,
          error: (err as Error).message,
        });
        return [];
      }

      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      let rawFacts: Array<{
        content?: string;
        category?: string;
        confidence?: number;
        entities?: string[];
      }>;
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(parsed)) return [];
        rawFacts = parsed;
      } catch {
        return [];
      }

      // KB cap to 3 facts per conversation (fact-extractor.ts:107).
      const created: Fact[] = [];
      const sourceConversationId =
        memory.tags.find((t) => t.startsWith('conversation:'))?.slice('conversation:'.length) ??
        undefined;

      for (const raw of rawFacts.slice(0, 3)) {
        if (!raw.content || raw.content.length < 10 || raw.content.length > 200) continue;
        if (!raw.entities || raw.entities.length === 0) continue;
        // v1.2.0 — entities normalised at storage: lowercase + trim. Reject if
        // the normalised list is empty (would violate FactSchema.entities.min(1)).
        const normalisedEntities = raw.entities
          .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
          .filter((e) => e.length > 0);
        if (normalisedEntities.length === 0) continue;
        const category: FactCategory = VALID_CATEGORIES.has(raw.category as FactCategory)
          ? (raw.category as FactCategory)
          : 'general';
        // Cap confidence per KB pattern (fact-extractor.ts:113). Use 0.85
        // baseline for AI-extracted (matches KB SOURCE_CONFIDENCE['chat']).
        const confidence = Math.min(raw.confidence ?? 0.6, 0.9);
        const candidate: Fact = {
          id: randomUUID(),
          fact: raw.content,
          entities: normalisedEntities,
          category,
          confidence,
          sourceType: 'ai-extraction',
          sourceMemoryId: memory.id,
          sourceConversationId,
          createdAt: new Date().toISOString(),
          isLatest: true,
          scopes: memory.scopes,
        };
        try {
          const validated = FactSchema.parse(candidate);
          await deps.structured.storeFact(validated);
          created.push(validated);
        } catch (err) {
          deps.logger.debug('arcana.ingest.extractFacts.invalid-fact', {
            memoryId,
            error: (err as Error).message,
          });
        }
      }

      deps.logger.debug('arcana.ingest.extractFacts', {
        memoryId,
        factsCreated: created.length,
      });
      return created;
    },
  };
}
