import { z } from 'zod';

/**
 * Arcana kernel configuration. Every field has a built-in default derived
 * from the locked decisions in arcana-spec.md §11. Consumers can override
 * any subset via a config file, env vars, or both.
 *
 * Note: scope of v0.1 is the *shape*. Real implementations consume these
 * values starting in v0.x.
 */
export const ConfigSchema = z
  .object({
    sleep: z
      .object({
        intervalMs: z.number().int().positive().default(3_600_000),
      })
      .strict()
      .default({}),

    decay: z
      .object({
        // Fact-confidence decay per week (cloud's gentler rate per SPEC).
        rate: z.number().min(0).max(1).default(0.02),
        // Floor below which decay stops.
        floor: z.number().min(0).max(1).default(0.3),
      })
      .strict()
      .default({}),

    retrieval: z
      .object({
        // Reciprocal Rank Fusion constant.
        rrfK: z.number().int().positive().default(60),
        // Graph expansion depth (1-3 typical; 0 disables expansion).
        graphHops: z.number().int().min(0).max(5).default(2),
        // Optional reranker — default off (latency).
        rerankerEnabled: z.boolean().default(false),
        topK: z.number().int().positive().default(50),
      })
      .strict()
      .default({}),

    chunking: z
      .object({
        size: z.number().int().positive().default(300),
        overlap: z.number().int().nonnegative().default(75),
      })
      .strict()
      .default({}),

    tier: z
      .object({
        // Cloud's stricter thresholds per SPEC adoption a20.
        hotPriorityThreshold: z.number().min(0).max(1).default(0.65),
        hotRecencyDays: z.number().int().positive().default(3),
        warmRecencyDays: z.number().int().positive().default(21),
      })
      .strict()
      .default({}),

    sourceWeights: z
      .object({
        terminal: z.number().min(0).max(1).default(0.95),
        chat: z.number().min(0).max(1).default(0.85),
        aiExtraction: z.number().min(0).max(1).default(0.6),
        upload: z.number().min(0).max(1).default(0.9),
        connector: z.number().min(0).max(1).default(0.85),
      })
      .strict()
      .default({}),

    logging: z
      .object({
        level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
      })
      .strict()
      .default({}),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;
