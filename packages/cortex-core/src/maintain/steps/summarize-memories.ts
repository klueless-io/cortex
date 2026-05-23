/**
 * Summarize Step — ported from KB sleep/steps/summarize.ts.
 *
 * AI-powered summary generation:
 * - Finds memories with no summary, very short summary, or raw JSON blobs
 * - Generates tier-appropriate summaries (rich for hot, compressed for archive)
 * - Limited to maxSummariesPerRun to control LLM costs
 *
 * Adapter note: KB reads files from disk and uses getSleepDb for the
 * maintenance_queue. Cortex uses memory.content directly (already stored)
 * and deps.structured.updateMemory.
 */

import type { Tier } from '@kybernesis/cortex-contracts';
import type { MaintainDeps } from '../index.js';
import type { SleepConfig } from '../config.js';

export interface SummarizeResult {
  count: number;
  errors?: string[];
}

function buildPrompt(
  content: string,
  tier: Tier,
  title: string,
  tags: string[],
): string {
  const ctx = [
    title ? `Title: ${title}` : '',
    tags.length > 0 ? `Tags: ${tags.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const ctxBlock = ctx ? `\nContext:\n${ctx}\n` : '';

  if (tier === 'hot') {
    return `Summarize this content for a personal knowledge system. This is a HIGH-PRIORITY memory. Write a rich, detailed summary (3-5 sentences) capturing the key topic, who was involved, decisions made, and why it matters. Third person, past tense.
${ctxBlock}
Content:\n${content}`;
  }

  if (tier === 'archive') {
    return `Summarize this content for a personal knowledge system. This is an ARCHIVED memory. Write a compressed summary (1-2 sentences) capturing only the core essence. Third person, past tense.
${ctxBlock}
Content:\n${content}`;
  }

  return `Summarize this content for a personal knowledge system. Write a clear summary (2-3 sentences) capturing the main topic, key points, and who was involved if relevant. Third person, past tense.
${ctxBlock}
Content:\n${content}`;
}

function needsSummary(summary: string): boolean {
  if (!summary || summary.length < 50) return true;
  if (summary.startsWith('{') || summary.startsWith('[')) return true;
  if (summary.startsWith('# ')) return true;
  return false;
}

export async function runSummarizeMemories(
  deps: MaintainDeps,
  config: SleepConfig,
): Promise<SummarizeResult> {
  const candidates = await deps.structured.listMemories({
    limit: config.maxSummariesPerRun * 4,
  });

  const toSummarize = candidates
    .filter((m) => needsSummary(m.summary))
    .slice(0, config.maxSummariesPerRun);

  if (toSummarize.length === 0) return { count: 0 };

  let summarized = 0;
  const errors: string[] = [];

  for (const memory of toSummarize) {
    const content = memory.content.slice(0, 4000);
    if (content.length < 20) continue;

    try {
      const prompt = buildPrompt(content, memory.tier, memory.title, memory.tags);
      const raw = await deps.llm.complete(prompt, { maxTokens: 300 });

      // Strip common LLM preamble patterns (mirrors KB's cleanup regex)
      const cleaned = raw
        .replace(
          /^(Here's|Here is|Summary|Memory Summary)[:\s]*/i,
          '',
        )
        .trim();

      if (cleaned.length > 20) {
        await deps.structured.updateMemory(memory.id, { summary: cleaned });
        summarized++;
      }
    } catch (err) {
      errors.push(`summarize failed for ${memory.id}: ${err}`);
    }
  }

  return {
    count: summarized,
    errors: errors.length > 0 ? errors : undefined,
  };
}
