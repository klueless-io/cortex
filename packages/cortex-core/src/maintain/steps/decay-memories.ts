/**
 * Decay Step — ported from KB sleep/steps/decay.ts per ADR 011.
 *
 * Three subjobs (matches KB decay.ts structure — KBOT H3 Bug 3 fix):
 *   1. Fact expiration sweep — facts past expires_at get is_latest = false.
 *   2. Memory decay-score + priority update — age-based, access-counterweight,
 *      with a per-cycle cap on the decay boost (KB decay.ts:81-118).
 *      Skips archive-tier memories (KB optimisation).
 *   3. Weekly fact-confidence decay — old un-reinforced AI/chat facts get
 *      confidence multiplied by 0.95 (floor 0.15). Provider gates internally
 *      to once-per-7-days so repeated sleep cycles don't compound.
 *
 * Adapter note: KB drives subjobs 1 + 3 via direct SQL UPDATE; Cortex
 * delegates them to provider methods (expireFacts, decayFactConfidence)
 * so the bulk semantics are preserved without leaking SQL into the kernel.
 */

import type { MaintainDeps } from '../index.js';
import type { SleepConfig } from '../config.js';

export interface DecayResult {
  count: number;
  processed: number;
  factsExpired: number;
  factsConfidenceDecayed: number;
  errors?: string[];
}

export async function runDecayMemories(
  deps: MaintainDeps,
  config: SleepConfig,
): Promise<DecayResult> {
  const errors: string[] = [];

  // ── Subjob 1: fact expiration sweep ─────────────────────────────────
  let factsExpired = 0;
  try {
    factsExpired = await deps.structured.expireFacts();
  } catch (err) {
    errors.push(`fact-expiration sweep failed: ${err}`);
  }

  // ── Subjob 2: memory decay-score + priority ─────────────────────────
  const memories = await deps.structured.listMemories({ limit: config.batchSize });
  const now = Date.now();
  let updated = 0;
  let processed = 0;

  for (const memory of memories) {
    if (memory.isPinned) continue;
    // KB optimisation — archive memories are already decayed; skip cycles.
    if (memory.tier === 'archive') continue;
    processed++;

    try {
      const ageMs = now - new Date(memory.createdAt).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);

      // KB decay.ts:81-118 — per-cycle decay boost capped at 20% of maxDecay
      // to prevent a single sleep run from jumping a memory to fully decayed.
      const decayBoost = Math.min(
        config.maxDecay * 0.2,
        ageHours * config.decayRatePerHour,
      );
      const accessFactor = 1 / (1 + memory.accessCount * 0.1);
      const boostedDecay = memory.decayScore + decayBoost * accessFactor;
      const newDecay = Math.min(config.maxDecay, boostedDecay);

      // KB priority adjustment — incremental, not replacement. Decay
      // halves into the priority hit; access count adds a small boost.
      const accessBoost = Math.min(0.1, memory.accessCount * 0.01);
      const newPriority = Math.max(
        0,
        Math.min(1, memory.priority - decayBoost / 2 + accessBoost),
      );

      if (
        Math.abs(newDecay - memory.decayScore) > 0.001 ||
        Math.abs(newPriority - memory.priority) > 0.001
      ) {
        await deps.structured.updateMemory(memory.id, {
          decayScore: newDecay,
          priority: newPriority,
        });
        updated++;
      }
    } catch (err) {
      errors.push(`decay failed for ${memory.id}: ${err}`);
    }
  }

  // ── Subjob 3: weekly fact-confidence decay ──────────────────────────
  // Provider gates internally — returns 0 if < 7 days since last run.
  let factsConfidenceDecayed = 0;
  try {
    factsConfidenceDecayed = await deps.structured.decayFactConfidence();
  } catch (err) {
    errors.push(`fact-confidence decay failed: ${err}`);
  }

  return {
    count: updated,
    processed,
    factsExpired,
    factsConfidenceDecayed,
    errors: errors.length > 0 ? errors : undefined,
  };
}
