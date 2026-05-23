/**
 * Tag Step — ported from KB sleep/steps/tag.ts.
 *
 * Refreshes stale or missing tags using the LLM:
 * - Identifies memories with no tags or tags older than tagStaleDays
 * - Generates 3-7 new tags via LLM
 * - Merges with existing tags (deduplication, lowercase)
 * - Limited to maxTagsPerRun to control LLM costs
 *
 * Adapter note: KB uses getClaudeClient() directly. Cortex uses deps.llm.
 */

import type { MaintainDeps } from '../index.js';
import type { SleepConfig } from '../config.js';

export interface TagResult {
  count: number;
  errors?: string[];
}

const TAG_PROMPT = `Generate 3-7 relevant tags for this content. Return only a JSON array of lowercase strings, no explanation.

Content:
{content}

Example response: ["meeting", "pricing", "strategy", "planning"]`;

export async function runRefreshTags(
  deps: MaintainDeps,
  config: SleepConfig,
): Promise<TagResult> {
  if (!config.enableTagging) return { count: 0 };

  const staleMs = config.tagStaleDays * 24 * 60 * 60 * 1000;
  const staleCutoff = new Date(Date.now() - staleMs);

  const candidates = await deps.structured.listMemories({
    limit: config.maxTagsPerRun * 3,
  });

  // Filter: no tags, or createdAt is before stale cutoff (lastEnriched not on schema;
  // using createdAt as a proxy — KB uses last_enriched but Cortex doesn't have that field)
  const stale = candidates
    .filter((m) => m.tags.length === 0 || new Date(m.createdAt) < staleCutoff)
    .slice(0, config.maxTagsPerRun);

  if (stale.length === 0) return { count: 0 };

  let tagged = 0;
  const errors: string[] = [];

  for (const memory of stale) {
    const content = [memory.title, memory.summary]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 3000);

    if (content.length < 50) continue;

    try {
      const response = await deps.llm.complete(
        TAG_PROMPT.replace('{content}', content),
        { maxTokens: 200 },
      );

      const jsonMatch = response.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) continue;

      const newTags: string[] = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(newTags) || newTags.length === 0) continue;

      const merged = [
        ...new Set([
          ...memory.tags.map((t) => t.toLowerCase()),
          ...newTags.map((t: string) => t.toLowerCase()),
        ]),
      ];

      await deps.structured.updateMemory(memory.id, { tags: merged });
      tagged++;
    } catch (err) {
      errors.push(`tag failed for ${memory.id}: ${err}`);
    }
  }

  return { count: tagged, errors: errors.length > 0 ? errors : undefined };
}
