/**
 * Reasoning Step — ported from KB sleep/steps/reasoning.ts.
 *
 * Cognitive engine: runs deduction and induction passes on entities with
 * enough facts to generate insights — things the agent has *figured out*,
 * not just stored.
 *
 * Two passes per entity (verbatim from KB reasoning.ts):
 * 1. Deduction (confidence 0.80+) — logically certain conclusions from 2+ facts
 * 2. Induction (confidence 0.60-0.75) — probable patterns from 3+ data points
 *
 * Adapter note: KB uses getEntitiesForReasoning / saveEntityInsight from
 * entity-graph.ts. Arcana uses deps.structured.listEntities +
 * deps.structured.getFactsForEntity + deps.structured.storeInsight.
 */

import { randomUUID } from 'node:crypto';
import type { InsightType } from '@kybernesis/arcana-contracts';
import type { MaintainDeps } from '../index.js';
import type { SleepConfig } from '../config.js';

export interface ReasoningResult {
  count: number;
  processed: number;
  errors?: string[];
}

// Prompts ported verbatim from KB reasoning.ts (DEDUCTION_PROMPT, INDUCTION_PROMPT)
const DEDUCTION_PROMPT = `Given these facts about "{name}", what can you LOGICALLY DERIVE that is CERTAINLY TRUE?

Every conclusion must follow from 2+ existing facts. Only include things that are definitely true based on the evidence — no speculation.

Facts about {name}:
{facts}

Return a JSON array of insights. Each must have "insight" (the conclusion), "reasoning" (which facts support it), and "confidence" (0.80-0.95).
Return [] if nothing can be logically derived.

Example: [{"insight":"David leads a portfolio company","reasoning":"David is CEO + company is a portfolio company","confidence":0.85}]`;

const INDUCTION_PROMPT = `Given these observations about "{name}", what PATTERNS do you detect? What is PROBABLY true?

Look for patterns across 3+ facts. Focus on habits, preferences, tendencies, relationships.

Facts about {name}:
{facts}

Return a JSON array. Each entry: "insight" (the pattern), "reasoning" (the evidence), "confidence" (0.60-0.75).
Return [] if no clear patterns.`;

interface ExtractedInsight {
  insight: string;
  reasoning: string;
  confidence: number;
}

async function runPass(
  llm: MaintainDeps['llm'],
  entityName: string,
  facts: string,
  prompt: string,
  type: InsightType,
  entityId: string,
  structured: MaintainDeps['structured'],
): Promise<number> {
  const filled = prompt
    .replace(/\{name\}/g, entityName)
    .replace('{facts}', facts);

  const response = await llm.complete(filled, { maxTokens: 800 });
  const jsonMatch = response.match(/\[[\s\S]*?\]/);
  if (!jsonMatch) return 0;

  const insights: ExtractedInsight[] = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(insights)) return 0;

  let saved = 0;
  for (const raw of insights) {
    if (!raw.insight || typeof raw.confidence !== 'number') continue;
    await structured.storeInsight({
      id: randomUUID(),
      entityId,
      type,
      statement: raw.insight,
      supportingFactIds: [],
      confidence: Math.min(1, Math.max(0, raw.confidence)),
      createdAt: new Date().toISOString(),
    });
    saved++;
  }
  return saved;
}

export async function runReasoning(
  deps: MaintainDeps,
  config: SleepConfig,
): Promise<ReasoningResult> {
  if (!config.enableReasoning) return { count: 0, processed: 0 };

  const entities = await deps.structured.listEntities({ limit: config.maxReasoningPerRun * 3 });

  // Only entities with enough facts to reason over (KB threshold: 3+)
  const candidates = entities
    .filter((e) => e.mentionCount >= 3)
    .slice(0, config.maxReasoningPerRun);

  if (candidates.length === 0) return { count: 0, processed: 0 };

  let totalInsights = 0;
  let processed = 0;
  const errors: string[] = [];

  for (const entity of candidates) {
    processed++;
    const facts = await deps.structured.getFactsForEntity(entity.name);
    if (facts.length < 2) continue;

    const factLines = facts
      .slice(0, 15)
      .map((f) => `- ${f.fact}`)
      .join('\n');

    try {
      // Deduction pass
      const deduced = await runPass(
        deps.llm,
        entity.name,
        factLines,
        DEDUCTION_PROMPT,
        'deduction',
        entity.id,
        deps.structured,
      );
      totalInsights += deduced;
    } catch (err) {
      errors.push(`deduction failed for ${entity.name}: ${err}`);
    }

    if (facts.length >= 3) {
      try {
        // Induction pass
        const induced = await runPass(
          deps.llm,
          entity.name,
          factLines,
          INDUCTION_PROMPT,
          'induction',
          entity.id,
          deps.structured,
        );
        totalInsights += induced;
      } catch (err) {
        errors.push(`induction failed for ${entity.name}: ${err}`);
      }
    }
  }

  return {
    count: totalInsights,
    processed,
    errors: errors.length > 0 ? errors : undefined,
  };
}
