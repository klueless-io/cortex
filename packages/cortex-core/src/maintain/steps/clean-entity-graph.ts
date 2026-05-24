/**
 * Entity Hygiene Step — ported from KB sleep/steps/entity-hygiene.ts per ADR 011.
 *
 * Cleans the entity graph by:
 * 1. Removing transcription artifacts (Speaker 0, Speaker 1, Unknown, etc.)
 * 2. Pruning noise topics: mention_count ≤ 1 AND type = 'topic' AND
 *    age ≥ pruneMinAgeDays AND not pinned AND no edges — mirrors KB
 *    entity-hygiene.ts:258-269 exactly (KBOT H3 Bug 2, 2026-05-24).
 *
 * Full AI-powered merge detection (KB's step 2/3) is deferred to v2 sleep —
 * it requires a more complex LLM loop that KB drives via mergeEntities() +
 * entity-graph.ts. For v1, automatic artifact removal + topic-focused
 * pruning achieves the primary noise-reduction goal.
 *
 * Adapter note: KB joins entities + entity_relations in one SQL statement.
 * Cortex iterates listEntities + calls getEdgesFor per candidate.
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

    // Phase 2: KB entity-hygiene.ts:258-269 — five conjoined filters.
    // All must hold for a prune. Any one fails → keep.
    if (entity.mentionCount > 1) continue;
    if (entity.type !== 'topic') continue;
    if (entity.isPinned) continue;

    // Age filter — entities without createdAt are treated as "age unknown"
    // and skipped (safer than guessing they're old).
    if (!entity.createdAt) continue;
    const ageMs = Date.now() - new Date(entity.createdAt).getTime();
    const minAgeMs = config.pruneMinAgeDays * 24 * 60 * 60 * 1000;
    if (ageMs < minAgeMs) continue;

    // No-edges filter — entity must have zero edges to either memories or
    // other entities. KB uses NOT EXISTS on entity_relations; Cortex
    // equivalent is getEdgesFor returning [].
    try {
      const edges = await deps.structured.getEdgesFor({ type: 'entity', id: entity.id });
      if (edges.length > 0) continue;
      await deps.structured.deleteEntity(entity.id);
      pruned++;
    } catch (err) {
      errors.push(`prune check failed for ${entity.name}: ${err}`);
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
