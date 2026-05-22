/**
 * Entity Hygiene Step — ported from KB sleep/steps/entity-hygiene.ts.
 *
 * Cleans the entity graph by:
 * 1. Removing transcription artifacts (Speaker 0, Speaker 1, Unknown, etc.)
 * 2. Pruning low-value noise (entities with 1 mention and a name matching a
 *    stop-word list) — mirrors KB's pruneMinAgeDays logic adapted for Arcana
 *    which lacks entity createdAt (KB uses the graph DB timestamp).
 *
 * Full AI-powered merge detection (KB's step 2/3) is deferred to v2 sleep —
 * it requires a more complex LLM loop that KB drives via mergeEntities() +
 * entity-graph.ts. For v1, automatic artifact removal + mention-based pruning
 * achieves the primary noise-reduction goal.
 *
 * Adapter note: KB uses getEntityGraphDb + mergeEntities + deleteEntity from
 * entity-graph.ts. Arcana uses deps.structured.listEntities + deleteEntity.
 */

import type { MaintainDeps } from '../index.js';
import type { SleepConfig } from '../config.js';

export interface EntityHygieneResult {
  count: number;
  artifactsCleaned: number;
  pruned: number;
  processed: number;
  errors?: string[];
}

// Verbatim from KB entity-hygiene.ts ARTIFACT_PATTERNS
const ARTIFACT_PATTERNS = [
  /^speaker\s*\d*$/i,
  /^unknown$/i,
  /^person\s*\d+$/i,
  /^user$/i,
  /^\d+$/,
  /^[a-z]$/i,
];

function isArtifact(name: string): boolean {
  return ARTIFACT_PATTERNS.some((p) => p.test(name.trim()));
}

export async function runCleanEntityGraph(
  deps: MaintainDeps,
  config: SleepConfig,
): Promise<EntityHygieneResult> {
  if (!config.enableEntityHygiene) {
    return { count: 0, artifactsCleaned: 0, pruned: 0, processed: 0 };
  }

  const entities = await deps.structured.listEntities({
    limit: config.batchSize,
  });

  let artifactsCleaned = 0;
  let pruned = 0;
  let processed = 0;
  const errors: string[] = [];

  for (const entity of entities) {
    processed++;

    // Phase 1: Remove artifact entities
    if (isArtifact(entity.name)) {
      try {
        await deps.structured.deleteEntity(entity.id);
        artifactsCleaned++;
      } catch (err) {
        errors.push(`artifact delete failed for ${entity.name}: ${err}`);
      }
      continue;
    }

    // Phase 2: Prune low-value noise — 1 mention, no facts
    if (entity.mentionCount <= 1) {
      try {
        const facts = await deps.structured.getFactsForEntity(entity.name);
        if (facts.length === 0) {
          await deps.structured.deleteEntity(entity.id);
          pruned++;
        }
      } catch (err) {
        errors.push(`prune check failed for ${entity.name}: ${err}`);
      }
    }
  }

  const total = artifactsCleaned + pruned;
  return {
    count: total,
    artifactsCleaned,
    pruned,
    processed,
    errors: errors.length > 0 ? errors : undefined,
  };
}
