import { z } from 'zod';

/**
 * An edge connects two nodes. A node is either a Memory or an Entity.
 * Using a discriminated union avoids the four-flat-optional-fields trap
 * (fromMemoryId / fromEntityId / toMemoryId / toEntityId) found in the
 * original KyberBot schema.
 */
export const NodeRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('memory'), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal('entity'), id: z.string().min(1) }).strict(),
]);

export type NodeRef = z.infer<typeof NodeRefSchema>;

/**
 * The `relation` vocabulary is intentionally permissive at v0.1. Unification
 * of the KyberBot 15-type vocab and the Kybernesis cloud 6-type vocab is an
 * open question (cortex-spec.md §14). Once locked, this becomes a z.enum.
 */
export const EdgeSchema = z
  .object({
    id: z.string().min(1),
    from: NodeRefSchema,
    to: NodeRefSchema,
    relation: z.string().min(1),
    confidence: z.number().min(0).max(1),
    sharedTags: z.array(z.string()),
    rationale: z.string().optional(),
    method: z.string(),
    createdAt: z.string().datetime(),
    lastVerifiedAt: z.string().datetime().optional(),
  })
  .strict();

export type Edge = z.infer<typeof EdgeSchema>;
