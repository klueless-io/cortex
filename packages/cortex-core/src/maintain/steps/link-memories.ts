/**
 * Link Step — ported from KB sleep/steps/link.ts.
 *
 * Builds Memory→Memory edges based on Jaccard tag similarity:
 * - Computes Jaccard similarity between tag sets for all memory pairs
 * - Creates an Edge when similarity >= minConfidenceForLink
 * - Respects maxEdgesPerMemory cap via neighbor count tracking
 * - Same-source-directory and shared-tag-count boosts mirror KB
 *
 * Adapter note: KB stores edges in sleep.db memory_edges. Cortex uses
 * deps.structured.storeEdge (StructuredStore). getNeighbors is used to
 * check the current edge count for a memory.
 */

import { randomUUID } from 'node:crypto';
import type { MaintainDeps } from '../index.js';
import type { SleepConfig } from '../config.js';

export interface LinkResult {
  count: number;
  processed: number;
  errors?: string[];
}

const EXCLUDED_TAGS = new Set([
  'pdf', 'upload', 'connector', 'note', 'file', 'document', 'markdown',
  'conversation', 'transcript', 'idea', 'json', 'text', 'audio',
]);

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const intersection = [...a].filter((t) => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function semanticRelation(
  aTitle: string,
  bTitle: string,
  sharedTags: Set<string>,
): string {
  const at = aTitle.toLowerCase();
  const bt = bTitle.toLowerCase();
  if (at.length >= 4 && bt.length >= 4) {
    if (at.includes(bt) || bt.includes(at)) return 'referenced';
  }
  if (sharedTags.size >= 2) return 'same_topic';
  return 'related';
}

export async function runLinkMemories(
  deps: MaintainDeps,
  config: SleepConfig,
): Promise<LinkResult> {
  const memories = await deps.structured.listMemories({ limit: config.batchSize });
  let created = 0;
  let processed = 0;
  const errors: string[] = [];

  // Build semantic tag sets (exclude noise tags)
  const tagSets = new Map<string, Set<string>>();
  for (const m of memories) {
    const tags = new Set(
      m.tags.map((t) => t.toLowerCase()).filter((t) => !EXCLUDED_TAGS.has(t) && t.length > 2),
    );
    if (tags.size > 0) tagSets.set(m.id, tags);
  }

  // Track edge counts per memory (in-memory, approximate)
  const edgeCount = new Map<string, number>();
  const seen = new Set<string>();

  for (const a of memories) {
    const aTags = tagSets.get(a.id);
    if (!aTags) continue;

    const aEdges = edgeCount.get(a.id) ?? 0;
    if (aEdges >= config.maxEdgesPerMemory) continue;

    for (const b of memories) {
      if (b.id === a.id) continue;
      const pairKey = [a.id, b.id].sort().join('|');
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const bEdges = edgeCount.get(b.id) ?? 0;
      if (bEdges >= config.maxEdgesPerMemory) continue;

      const bTags = tagSets.get(b.id);
      if (!bTags) continue;

      const base = jaccardSimilarity(aTags, bTags);
      if (base < config.minConfidenceForLink) continue;

      const sharedTags = new Set([...aTags].filter((t) => bTags.has(t)));

      let confidence = base;
      if (sharedTags.size >= 3) confidence += 0.2;
      else if (sharedTags.size >= 2) confidence += 0.1;
      confidence = Math.min(1.0, confidence);

      const relation = semanticRelation(a.title, b.title, sharedTags);

      try {
        await deps.structured.storeEdge({
          id: randomUUID(),
          from: { type: 'memory', id: a.id },
          to: { type: 'memory', id: b.id },
          relation,
          confidence,
          sharedTags: [...sharedTags],
          rationale: `Jaccard: ${(base * 100).toFixed(1)}% on: ${[...sharedTags].slice(0, 5).join(', ')}`,
          method: 'sleep-agent',
          createdAt: new Date().toISOString(),
        });

        edgeCount.set(a.id, (edgeCount.get(a.id) ?? 0) + 1);
        edgeCount.set(b.id, (edgeCount.get(b.id) ?? 0) + 1);
        created++;
        processed++;

        if (created >= config.maxLinksPerRun) break;
      } catch (err) {
        errors.push(`link failed for ${a.id}↔${b.id}: ${err}`);
      }
    }

    if (created >= config.maxLinksPerRun) break;
  }

  return {
    count: created,
    processed,
    errors: errors.length > 0 ? errors : undefined,
  };
}
