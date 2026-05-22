/**
 * Profile Step — ported from KB sleep/steps/profile.ts.
 *
 * Regenerates the entity profile for the most-mentioned entity (acting as the
 * "user profile" in Arcana's schema). Runs after observe so facts are fresh.
 *
 * Adapter note: KB uses generateUserProfile / cacheProfile from user-profile.ts
 * and a time-based freshness gate. Arcana stores the result via
 * deps.structured.storeEntityProfile. The freshness gate uses the entity with
 * the highest mentionCount as the profile target (KB's heuristic for "user").
 */

import { randomUUID } from 'node:crypto';
import type { MaintainDeps } from '../index.js';
import type { SleepConfig } from '../config.js';

export interface ProfileResult {
  count: number;
  processed: number;
  errors?: string[];
}

const PROFILE_PROMPT = `You are building a concise user profile for a personal knowledge system.

Given the following facts about {name}, write:
1. A short narrative (2-4 sentences) summarising who this person is
2. Key static facts (name, occupation, location, relationships) as bullet points

Facts:
{facts}

Return JSON: { "narrative": "...", "staticFacts": [{"value": "..."}] }`;

export async function runRebuildUserProfile(
  deps: MaintainDeps,
  config: SleepConfig,
): Promise<ProfileResult> {
  if (!config.enableUserProfile) return { count: 0, processed: 1 };

  const entities = await deps.structured.listEntities({ limit: 10 });
  if (entities.length === 0) return { count: 0, processed: 0 };

  // Use the most-mentioned entity as the user proxy (mirrors KB's user-profile heuristic)
  const topEntity = entities.reduce((best, e) =>
    e.mentionCount > best.mentionCount ? e : best,
  );

  const existingProfile = await deps.structured.getEntityProfile(topEntity.id);

  // Freshness gate — skip if profile was recently built
  if (existingProfile) {
    const profileAge = Date.now() - new Date(existingProfile.staticFacts[0]?.recordedAt ?? 0).getTime();
    const refreshMs = config.profileRefreshMinutes * 60 * 1000;
    if (profileAge < refreshMs) return { count: 0, processed: 1 };
  }

  const facts = await deps.structured.getFactsForEntity(topEntity.name);
  if (facts.length === 0) return { count: 0, processed: 1 };

  const factLines = facts
    .slice(0, 20)
    .map((f) => `- ${f.fact} (confidence: ${f.confidence.toFixed(2)})`)
    .join('\n');

  try {
    const response = await deps.llm.complete(
      PROFILE_PROMPT.replace('{name}', topEntity.name).replace('{facts}', factLines),
      { maxTokens: 600 },
    );

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { count: 0, processed: 1 };

    const parsed: { narrative?: string; staticFacts?: Array<{ value: string }> } =
      JSON.parse(jsonMatch[0]);

    const now = new Date().toISOString();
    await deps.structured.storeEntityProfile({
      id: existingProfile?.id ?? randomUUID(),
      entityId: topEntity.id,
      staticFacts: (parsed.staticFacts ?? []).map((sf) => ({
        value: sf.value,
        recordedAt: now,
      })),
      dynamicContext: parsed.narrative ?? '',
      narrativeProse: parsed.narrative,
      relatedEntityIds: [],
    });

    return { count: 1, processed: 1 };
  } catch (err) {
    return { count: 0, processed: 1, errors: [`profile rebuild failed: ${err}`] };
  }
}
