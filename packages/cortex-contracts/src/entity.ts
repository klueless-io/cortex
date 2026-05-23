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
  })
  .strict();

export type Entity = z.infer<typeof EntitySchema>;
