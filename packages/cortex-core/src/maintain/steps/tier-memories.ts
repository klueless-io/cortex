/**
 * Tier Step — ported from KB sleep/steps/tier.ts per ADR 011.
 *
 * Moves memories between hot / warm / archive tiers using OR semantics
 * across five signals (priority, decay, recency, relationship score, raw
 * edge count). Mirrors KB's tier.ts:81-87. Earlier Cortex versions used
 * AND semantics + dropped the relationship signals; that port deviation
 * is fixed here (KBOT H3 Bug 1, 2026-05-24).
 *
 * Adapter note: KB reads from getTimelineDb directly. Cortex uses
 * deps.structured.listMemories + deps.structured.getEdgesFor (for the
 * two edge-derived signals) + updateMemory.
 */

import type { Tier } from '@kybernesis/cortex-contracts';
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
  edgeCount: number,
  relationshipScore: number,
  config: SleepConfig,
): Tier {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const daysSinceAccess = lastAccessedAt
    ? (now - new Date(lastAccessedAt).getTime()) / DAY_MS
    : Infinity;

  // KB tier.ts:81-87 — OR across five signals; any one trips hot.
  const isHot =
    priority >= config.hotPriorityThreshold ||
    decayScore <= config.hotDecayThreshold ||
    daysSinceAccess <= config.hotAccessDays ||
    relationshipScore >= config.hotEdgeCount ||
    edgeCount >= 4;

  if (isHot) return 'hot';

  // Same OR shape for warm — weaker thresholds across the same signals.
  const isWarm =
    priority >= config.warmPriorityThreshold ||
    (daysSinceAccess <= config.warmAccessDays && accessCount > 0) ||
    relationshipScore >= config.warmEdgeCount ||
    edgeCount >= 2;

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

    // Edge-derived signals — KB joins memory_edges; Cortex fetches per memory.
    let edgeCount = 0;
    let relationshipScore = 0;
    try {
      const edges = await deps.structured.getEdgesFor({ type: 'memory', id: memory.id });
      edgeCount = edges.length;
      relationshipScore = edges.reduce((sum, e) => sum + e.confidence, 0);
    } catch (err) {
      // Edge fetch failure shouldn't kill the whole step; log and proceed
      // with edge signals at zero (matches a memory with no edges).
      deps.logger.debug('cortex.maintain.tier-memories.edges-failed', {
        memoryId: memory.id,
        error: (err as Error).message,
      });
    }

    const newTier = computeTier(
      memory.priority,
      memory.decayScore,
      memory.lastAccessedAt,
      memory.accessCount,
      edgeCount,
      relationshipScore,
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
