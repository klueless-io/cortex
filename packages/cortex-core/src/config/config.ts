import { z } from 'zod';

/**
 * Cortex kernel configuration shape.
 *
 * ⚠ STATUS as of v2.1.5: this schema is **defined and exported but not
 * yet wired into the kernel**. Calling `loadConfig()` returns a validated
 * `Config` object, but `createCortex()` does not accept it and the
 * runtime kernel reads from independent sources:
 *
 *   - `maintain` uses `SleepConfig` (packages/cortex-core/src/maintain/config.ts)
 *     with its own hardcoded defaults — Config.sleep / Config.decay are ignored
 *   - `retrieve.hybridSearch` hardcodes `RRF_K = 60` — Config.retrieval.rrfK ignored
 *   - tier evaluation / source weighting / chunking / logging — all hardcoded
 *
 * Treat the schema as the *target* config surface, not the live one. A future
 * release will route these fields into the kernel via createCortex(opts).
 * Until then any value you pass through loadConfig is informational only.
 *
 * Tracking: docs/SYSTEM-HEALTH.md — pattern B (contract promises code doesn't keep).
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
