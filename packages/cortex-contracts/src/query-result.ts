import { z } from 'zod';

/**
 * Freshness envelope for read operations. Lifted from AppySentinel's
 * QueryResult pattern. Lets agents know whether the data they're seeing is
 * fresh or stale, and how old it is.
 *
 * `stale` is computed by the producer based on a TTL relevant to the read
 * surface — e.g., an entity profile might be considered stale after 24h
 * since last refresh, while a memory tier might use a 5-minute window.
 */
export interface QueryResult<T> {
  data: T;
  generated_at: string;
  data_age_ms: number;
  stale: boolean;
}

/**
 * Schema factory for runtime validation of QueryResult envelopes. Pass the
 * inner data schema; returns a schema for the full envelope.
 *
 * @example
 * const memoryQueryResultSchema = queryResultSchema(MemorySchema);
 * const parsed = memoryQueryResultSchema.parse(apiResponse);
 */
export function queryResultSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z
    .object({
      data: dataSchema,
      generated_at: z.string().datetime(),
      data_age_ms: z.number().int().nonnegative(),
      stale: z.boolean(),
    })
    .strict();
}
