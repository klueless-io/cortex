import { z } from 'zod';
import { ScopesSchema } from './scopes.js';

export const TierSchema = z.enum(['hot', 'warm', 'archive']);
export type Tier = z.infer<typeof TierSchema>;

export const MemorySourceSchema = z.enum([
  'upload',
  'chat',
  'connector',
  'watched-folder',
  'cli',
  'channel',
]);
export type MemorySource = z.infer<typeof MemorySourceSchema>;

/**
 * Lifecycle status for a Memory. `active` is the default — the memory is live
 * and visible to retrieval. `archived` removes it from default retrieval but
 * keeps it queryable explicitly. `deleted` is a soft-delete tombstone — the
 * row is retained for audit/supersession trails but treated as absent by all
 * default reads. See ADR 007 §3.
 */
export const MemoryStatusSchema = z.enum(['active', 'archived', 'deleted']);
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

export const MemorySchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    summary: z.string(),
    content: z.string(),
    tags: z.array(z.string()),
    priority: z.number().min(0).max(1),
    tier: TierSchema,
    decayScore: z.number().min(0).max(1),
    accessCount: z.number().int().nonnegative(),
    /**
     * ISO-8601 timestamp of when this Memory was first written. Used by the
     * temporal retrieval channel in hybridSearch (ordering by recency).
     * Required since v0.4.0 (ADR 011 — port-first principle; KyberBot's
     * timeline events carry a timestamp, so Cortex's memories must too).
     * Set by `ingest.storeMemory` via `new Date().toISOString()` when the
     * caller doesn't supply one.
     */
    createdAt: z.string().datetime(),
    lastAccessedAt: z.string().datetime().optional(),
    isPinned: z.boolean(),
    contentHash: z.string(),
    source: MemorySourceSchema,
    status: MemoryStatusSchema,
    /**
     * `true` if this Memory is the current version; `false` once another
     * Memory supersedes it. See ADR 007 §3.2. Defaults to `true` at write
     * time (set by `ingest.storeMemory`). Flipped to `false` only via
     * `markMemorySuperseded`, which also fills `supersededBy`.
     */
    isLatest: z.boolean(),
    /** When `isLatest` is `false`, the id of the Memory that replaced this one. */
    supersededBy: z.string().min(1).optional(),
    scopes: ScopesSchema.optional(),
  })
  .strict();

export type Memory = z.infer<typeof MemorySchema>;

/**
 * Chunks are sub-pieces of a Memory after text splitting. Their `layer` is
 * kept in sync with the parent memory's tier (see cortex-spec.md §4).
 */
export const ChunkSchema = z
  .object({
    id: z.string().min(1),
    memoryId: z.string().min(1),
    text: z.string(),
    vectorId: z.string().optional(),
    layer: TierSchema,
  })
  .strict();

export type Chunk = z.infer<typeof ChunkSchema>;
