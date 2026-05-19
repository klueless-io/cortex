import { randomUUID } from 'node:crypto';
import {
  MemorySchema,
  type Memory,
  type Scopes,
  type StructuredStore,
  type VectorStore,
  type EmbeddingProvider,
  type LLMProvider,
  type Logger,
} from '@kybernesisai/arcana-contracts';
import { NotImplementedError } from '../errors.js';
import { djb2Hash } from '../util/hash.js';

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
        isPinned: false,
        contentHash: djb2Hash(input.content),
        source: input.source,
        status: 'active',
        isLatest: true,
        scopes: input.scopes,
      });

      await deps.structured.storeMemory(memory);
      deps.logger.debug('arcana.ingest.storeMemory', { id: memory.id });
      return memory.id;
    },

    ingestDocument: async () => {
      throw new NotImplementedError(
        'arcana-core/ingest.ingestDocument is still a stub; lands when document ingestion is demanded by a consumer',
      );
    },
  };
}
