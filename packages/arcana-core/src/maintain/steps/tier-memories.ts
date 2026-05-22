/**
 * Tier Step — ported from KB sleep/steps/tier.ts.
 *
 * Moves memories between hot / warm / archive tiers:
 * - hot:     high priority, low decay, recently accessed
 * - warm:    moderate priority or moderate recency
 * - archive: low priority, high decay, or long-inactive
 *
 * Adapter note: KB reads from getTimelineDb directly. Arcana uses
 * deps.structured.listMemories + updateMemory.
 */

import type { Tier } from '@kybernesis/arcana-contracts';
import type { MaintainDeps } from '../index.js';
import type { SleepConfig } from '../config.js';

export interface TierResult {
  count: number;
  errors?: string[];
}

function computeTier(
  priority: number,
  decayScore: number,
  lastAccessedAt: string | undefined,
  accessCount: number,
  config: SleepConfig,
): Tier {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const daysSinceAccess = lastAccessedAt
    ? (now - new Date(lastAccessedAt).getTime()) / DAY_MS
    : Infinity;

  const isHot =
    priority >= config.hotPriorityThreshold &&
    decayScore < config.hotDecayThreshold &&
    daysSinceAccess <= config.hotAccessDays;

  if (isHot) return 'hot';

  const isWarm =
    priority >= config.warmPriorityThreshold ||
    (daysSinceAccess <= config.warmAccessDays && accessCount > 0);

  if (isWarm) return 'warm';

  return 'archive';
}

export async function runTierMemories(
  deps: MaintainDeps,
  config: SleepConfig,
): Promise<TierResult> {
  const memories = await deps.structured.listMemories({ limit: config.batchSize });
  let changed = 0;
  const errors: string[] = [];

  for (const memory of memories) {
    if (memory.isPinned) continue;

    const newTier = computeTier(
      memory.priority,
      memory.decayScore,
      memory.lastAccessedAt,
      memory.accessCount,
      config,
    );

    if (newTier === memory.tier) continue;

    try {
      await deps.structured.updateMemory(memory.id, { tier: newTier });
      changed++;
    } catch (err) {
      errors.push(`tier update failed for ${memory.id}: ${err}`);
    }
  }

  return {
    count: changed,
    errors: errors.length > 0 ? errors : undefined,
  };
}
