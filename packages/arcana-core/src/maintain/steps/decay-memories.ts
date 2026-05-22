/**
 * Decay Step — ported from KB sleep/steps/decay.ts.
 *
 * Applies time-based decay to memories:
 * - Older memories accumulate a higher decayScore
 * - Decay reduces priority over time
 * - accessCount counteracts decay (frequently accessed = important)
 * - Pinned memories are exempt
 *
 * Adapter note: KB reads from getTimelineDb(root) directly.
 * Arcana uses deps.structured (StructuredStore) instead.
 */

import type { MaintainDeps } from '../index.js';
import type { SleepConfig } from '../config.js';

export interface DecayResult {
  count: number;
  processed: number;
  errors?: string[];
}

export async function runDecayMemories(
  deps: MaintainDeps,
  config: SleepConfig,
): Promise<DecayResult> {
  const memories = await deps.structured.listMemories({ limit: config.batchSize });
  const now = Date.now();
  let updated = 0;
  let processed = 0;
  const errors: string[] = [];

  for (const memory of memories) {
    if (memory.isPinned) continue;
    processed++;

    try {
      const ageMs = now - new Date(memory.createdAt).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);

      // Decay accumulates with age, counteracted by access frequency.
      // Mirror KB decay.ts formula: decay += rate * hours, access reduces it.
      const rawDecay = config.decayRatePerHour * ageHours;
      const accessFactor = 1 / (1 + memory.accessCount * 0.1);
      const newDecay = Math.min(config.maxDecay, rawDecay * accessFactor);

      // Priority is inverse of decay, floored at 0.
      const newPriority = Math.max(0, 1 - newDecay);

      if (
        Math.abs(newDecay - memory.decayScore) > 0.001 ||
        Math.abs(newPriority - memory.priority) > 0.001
      ) {
        await deps.structured.updateMemory(memory.id, {
          decayScore: newDecay,
          priority: newPriority,
        });
        updated++;
      }
    } catch (err) {
      errors.push(`decay failed for ${memory.id}: ${err}`);
    }
  }

  return {
    count: updated,
    processed,
    errors: errors.length > 0 ? errors : undefined,
  };
}
