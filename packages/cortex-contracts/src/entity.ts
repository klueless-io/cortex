import { z } from 'zod';
import { ScopesSchema } from './scopes.js';

export const EntityTypeSchema = z.enum([
  'person',
  'company',
  'project',
  'place',
  'topic',
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const EntitySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: EntityTypeSchema,
    mentionCount: z.number().int().nonnegative(),
    scopes: ScopesSchema.optional(),
    /**
     * v2.1.8 — ISO 8601 timestamp; set on upsertEntity for new rows.
     * Used by entity-hygiene Phase 2 prune to check `pruneMinAgeDays`
     * (KB entity-hygiene.ts:258-269). Optional so legacy v0.x/v1.x
     * databases don't break — entities without createdAt are treated
     * as "age unknown, age filter does not exclude them".
     */
    createdAt: z.string().datetime().optional(),
    /**
     * v2.1.8 — protects an entity from sleep-pipeline pruning. Mirrors
     * KB entity-hygiene.ts:259's `is_pinned IS NULL OR is_pinned = 0`
     * filter. Optional; defaults to false (not pinned).
     */
    isPinned: z.boolean().optional(),
  })
  .strict();

export type Entity = z.infer<typeof EntitySchema>;
