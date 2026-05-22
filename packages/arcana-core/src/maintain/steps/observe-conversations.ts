/**
 * Observe Step — ported from KB sleep/steps/observe.ts.
 *
 * Extracts structured facts from recent chat memories and stores them.
 * This is the sleep-path version of ingest.extractFacts:
 * - Finds recently ingested chat memories that haven't been fact-extracted yet
 * - LLM extracts facts (content, category, confidence, entities)
 * - Each valid fact is stored via deps.structured.storeFact
 *
 * Adapter note: KB's observe step targets the facts table via ensureFactsTable
 * and storeFact from fact-store.ts. Arcana uses deps.structured.storeFact.
 * The extraction prompt is ported verbatim from KB fact-extractor.ts:20-31
 * (FACT_EXTRACTION_PROMPT, also used in Arcana's ingest.extractFacts).
 */

import { randomUUID } from 'node:crypto';
import type { Fact, FactCategory } from '@kybernesis/arcana-contracts';
import type { MaintainDeps } from '../index.js';
import type { SleepConfig } from '../config.js';

export interface ObserveResult {
  count: number;
  processed: number;
  errors?: string[];
}

const VALID_CATEGORIES = new Set<FactCategory>([
  'biographical', 'preference', 'event', 'relationship',
  'temporal', 'opinion', 'plan', 'general',
]);

const FACT_EXTRACTION_PROMPT = `Extract key facts from this conversation as a JSON array of objects.

Each fact object has:
- "content": The fact statement (8-25 words, specific and verifiable)
- "category": One of: biographical, preference, event, relationship, temporal, opinion, plan, general
- "confidence": 0.7-0.95 (how confident you are this is accurate)
- "entities": Array of person/entity names mentioned in this fact

Rules:
- Each fact must be SPECIFIC and verifiable — not vague
- Include the person's NAME in each fact (never use pronouns)
- Include dates, numbers, and proper nouns whenever mentioned
- Prefer: relationships, preferences, events, decisions, origins, occupations
- Skip: greetings, opinions about the conversation itself, meta-commentary
- 5-15 facts depending on conversation length

Example output:
[
  {"content": "Caroline moved from Sweden 4 years ago", "category": "biographical", "confidence": 0.9, "entities": ["Caroline"]},
  {"content": "Melanie's daughter's birthday is August 13", "category": "event", "confidence": 0.85, "entities": ["Melanie"]}
]

Conversation:
`;

export async function runObserveConversations(
  deps: MaintainDeps,
  config: SleepConfig,
): Promise<ObserveResult> {
  if (!config.enableFactExtraction) return { count: 0, processed: 0 };

  // Target chat memories; limit to recent batch
  const memories = await deps.structured.listMemories({ limit: config.batchSize });
  const chatMemories = memories
    .filter((m) => m.source === 'chat')
    .slice(0, config.maxObservationsPerRun);

  if (chatMemories.length === 0) return { count: 0, processed: 0 };

  let factsCreated = 0;
  let processed = 0;
  const errors: string[] = [];

  for (const memory of chatMemories) {
    const content = memory.content.slice(0, 2000);
    if (content.length < 50) continue;
    processed++;

    try {
      const response = await deps.llm.complete(
        FACT_EXTRACTION_PROMPT + content,
        { maxTokens: 1000 },
      );

      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) continue;

      const extracted: Array<{
        content: string;
        category: string;
        confidence: number;
        entities: string[];
      }> = JSON.parse(jsonMatch[0]);

      if (!Array.isArray(extracted)) continue;

      for (const raw of extracted.slice(0, config.maxFactsPerRun)) {
        if (!raw.content || raw.content.length < 10 || raw.content.length > 200) continue;
        if (!Array.isArray(raw.entities) || raw.entities.length === 0) continue;

        const category: FactCategory = VALID_CATEGORIES.has(raw.category as FactCategory)
          ? (raw.category as FactCategory)
          : 'general';

        // v1.2.0 — entities normalised at storage: lowercase + trim.
        const normalisedEntities = raw.entities
          .map((e: unknown) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
          .filter((e: string) => e.length > 0);
        if (normalisedEntities.length === 0) continue;

        const fact: Fact = {
          id: randomUUID(),
          fact: raw.content,
          category,
          confidence: Math.min(0.9, Math.max(0, raw.confidence ?? 0.7)),
          entities: normalisedEntities,
          sourceType: 'ai-extraction',
          sourceMemoryId: memory.id,
          isLatest: true,
          createdAt: new Date().toISOString(),
        };

        await deps.structured.storeFact(fact);
        factsCreated++;
      }
    } catch (err) {
      errors.push(`observe failed for ${memory.id}: ${err}`);
    }
  }

  return {
    count: factsCreated,
    processed,
    errors: errors.length > 0 ? errors : undefined,
  };
}
