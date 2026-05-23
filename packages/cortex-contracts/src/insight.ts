import { z } from 'zod';

export const ProfileEntrySchema = z
  .object({
    value: z.string().min(1),
    factId: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
    recordedAt: z.string().datetime().optional(),
  })
  .strict();

export type ProfileEntry = z.infer<typeof ProfileEntrySchema>;

export const InsightTypeSchema = z.enum(['deduction', 'induction']);
export type InsightType = z.infer<typeof InsightTypeSchema>;

export const InsightSchema = z
  .object({
    id: z.string().min(1),
    entityId: z.string().optional(),
    type: InsightTypeSchema,
    statement: z.string().min(1),
    supportingFactIds: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    createdAt: z.string().datetime(),
  })
  .strict();

export type Insight = z.infer<typeof InsightSchema>;

export const EntityProfileSchema = z
  .object({
    id: z.string().min(1),
    entityId: z.string().min(1),
    staticFacts: z.array(ProfileEntrySchema),
    dynamicContext: z.string(),
    narrativeProse: z.string().optional(),
    relatedEntityIds: z.array(z.string()),
  })
  .strict();

export type EntityProfile = z.infer<typeof EntityProfileSchema>;
