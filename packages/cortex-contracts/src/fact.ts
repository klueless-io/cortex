import { z } from 'zod';
import { ScopesSchema } from './scopes.js';

export const FactSourceTypeSchema = z.enum([
  'terminal',
  'chat',
  'ai-extraction',
  'upload',
  'connector',
]);
export type FactSourceType = z.infer<typeof FactSourceTypeSchema>;

/**
 * Fact category — ported verbatim from KyberBot fact-store.ts:38-46.
 * Used for retrieval filtering (e.g., "return only biographical facts about Alice").
 */
export const FactCategorySchema = z.enum([
  'biographical',
  'preference',
  'event',
  'relationship',
  'temporal',
  'opinion',
  'plan',
  'general',
]);
export type FactCategory = z.infer<typeof FactCategorySchema>;

/**
 * A Fact is an entity-attributed assertion. The `fact` field carries the
 * sentence form (always required). `entities` is the denormalised list of
 * entity names this fact mentions; the optional `attribute` / `value` fields
 * carry a triple decomposition when the extractor was able to produce one.
 *
 * Schema-depth rationale (see ADR 013, narrowing ADR 004):
 *   - v1.0.0 widens facts to carry multi-entity denormalisation, source
 *     backlinks, and category — matching KyberBot's empirical fact-store
 *     schema. Unblocks parity-via-swap and enables direct fact-level
 *     full-text retrieval (Layer 0 of factRetrieval).
 *   - ADR 004 still governs attribute/value optionality WITHIN the deeper
 *     schema — both KB and Kyber-in-Cloud-style extractors still vary in
 *     whether they produce triple decomposition.
 */
export const FactSchema = z
  .object({
    id: z.string().min(1),
    fact: z.string().min(1),
    /**
     * Denormalised list of entity names this fact mentions. v1.0.0 — replaces
     * single `entity`. v1.2.0 — stored lowercased + trimmed for canonical matching;
     * the Entity row preserves original casing for display. Producers
     * (ingest.extractFacts, command.recordFact, maintain.observeConversations)
     * normalise before storage; consumers may pass any casing to
     * `getFactsForEntity` which normalises the lookup key.
     */
    entities: z.array(z.string().min(1)).min(1),
    attribute: z.string().optional(),
    value: z.string().optional(),
    confidence: z.number().min(0).max(1),
    sourceType: FactSourceTypeSchema,
    /** v1.0.0 — backlink to the Memory this fact was extracted from. */
    sourceMemoryId: z.string().min(1).optional(),
    /** v1.0.0 — file/note origin (when applicable). */
    sourcePath: z.string().optional(),
    /** v1.0.0 — conversation/session origin (when applicable). */
    sourceConversationId: z.string().optional(),
    /** v1.0.0 — required; extractors default to 'general' when unclassified. */
    category: FactCategorySchema,
    createdAt: z.string().datetime(),
    lastReinforcedAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional(),
    isLatest: z.boolean(),
    supersededBy: z.string().optional(),
    surprisalScore: z.number().min(0).max(1).optional(),
    scopes: ScopesSchema.optional(),
  })
  .strict();

export type Fact = z.infer<typeof FactSchema>;

/**
 * Pre-v1.0.0 Fact shape. Kept as a TypeScript interface (not a Zod schema) so
 * legacy callers can construct it without going through validation, and so
 * `widenLegacyFact` has a typed input.
 */
export interface LegacyFact {
  id: string;
  fact: string;
  entity: string;
  attribute?: string;
  value?: string;
  confidence: number;
  sourceType: FactSourceType;
  createdAt: string;
  lastReinforcedAt?: string;
  expiresAt?: string;
  isLatest: boolean;
  supersededBy?: string;
  surprisalScore?: number;
  scopes?: z.infer<typeof ScopesSchema>;
}

/**
 * Migration helper: wrap a pre-v1.0.0 Fact into the v1.0.0 shape.
 * `entity` (single) → `entities: [entity]`; `category` defaults to 'general';
 * source backlinks are left undefined. See ADR 013 Findings appendix.
 */
export function widenLegacyFact(old: LegacyFact): Fact {
  const { entity, ...rest } = old;
  return {
    ...rest,
    entities: [entity],
    category: 'general',
  };
}

export const ContradictionStatusSchema = z.enum([
  'pending',
  'auto-resolved',
  'user-resolved',
]);
export type ContradictionStatus = z.infer<typeof ContradictionStatusSchema>;

/**
 * Contradiction shape rationale (see ADR 006):
 * - `rationale` (optional) captures WHY the contradiction was flagged —
 *   typically the LLM-extracted explanation. Distinct from `resolution`:
 *     - `rationale` = why detected (input, set at create time)
 *     - `resolution` = how resolved (output, set when status transitions)
 *   They are separate axes; conflating them would lose signal.
 */
export const ContradictionSchema = z
  .object({
    id: z.string().min(1),
    factAId: z.string().min(1),
    factBId: z.string().min(1),
    status: ContradictionStatusSchema,
    rationale: z.string().optional(),
    resolution: z.string().optional(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type Contradiction = z.infer<typeof ContradictionSchema>;
