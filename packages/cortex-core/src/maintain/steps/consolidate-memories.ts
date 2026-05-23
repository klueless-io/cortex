/**
 * Consolidate Step — ported from KB sleep/steps/consolidate.ts.
 *
 * Merges repeated memories with identical or near-identical titles:
 * - Groups by normalized title (strips channel prefix, trailing ellipsis)
 * - When a group meets the threshold, deletes older entries and keeps newest
 * - Prevents memory bloat from heartbeat tasks and repetitive content
 *
 * Adapter note: KB queries getTimelineDb directly. Cortex uses
 * deps.structured.listMemories + deleteMemory.
 */

import type { MaintainDeps } from '../index.js';
import type { SleepConfig } from '../config.js';

export interface ConsolidateResult {
  count: number;
  processed: number;
  errors?: string[];
}

const REPETITIVE_PATTERNS = [
  /heartbeat\s+task/i,
  /heartbeat-state/i,
  /check\s+posthog/i,
];

function normalizeTitle(title: string): string {
  // Strip channel prefix [xxx] and trailing …
  return title
    .replace(/^\[.*?\]\s*/, '')
    .replace(/\.{2,}$/, '')
    .trim()
    .toLowerCase();
}

function isRepetitive(title: string): boolean {
  return REPETITIVE_PATTERNS.some((p) => p.test(title));
}

export async function runConsolidateMemories(
  deps: MaintainDeps,
  config: SleepConfig,
): Promise<ConsolidateResult> {
  if (!config.enableConsolidation) return { count: 0, processed: 0 };

  const memories = await deps.structured.listMemories({ limit: config.batchSize });
  let consolidated = 0;
  let processed = 0;
  const errors: string[] = [];

  // Group by normalized title
  const groups = new Map<string, typeof memories>();
  for (const m of memories) {
    if (m.isPinned) continue;
    const key = normalizeTitle(m.title);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  for (const [, group] of groups) {
    if (group.length < config.consolidationTitleThreshold) continue;
    processed++;

    // Sort by createdAt ascending; keep the newest (last)
    group.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    const keep = group[group.length - 1];
    const remove = group.slice(0, -1);

    // Apply heavy decay multiplier to repetitive content even on the survivor
    if (isRepetitive(keep.title)) {
      const newDecay = Math.min(
        config.maxDecay,
        keep.decayScore * config.repetitiveDecayMultiplier,
      );
      try {
        await deps.structured.updateMemory(keep.id, {
          decayScore: newDecay,
          priority: Math.max(0, 1 - newDecay),
        });
      } catch {
        // non-fatal
      }
    }

    for (const m of remove) {
      try {
        await deps.structured.deleteMemory(m.id);
        consolidated++;
      } catch (err) {
        errors.push(`consolidate delete failed for ${m.id}: ${err}`);
      }
    }
  }

  return {
    count: consolidated,
    processed,
    errors: errors.length > 0 ? errors : undefined,
  };
}
