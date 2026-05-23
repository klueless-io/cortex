/**
 * v1.2.0 — End-to-end pipeline integration test.
 *
 * Seeds a chat memory + an entity, runs the three LLM-driven sleep steps
 * (observe → rebuildUserProfile → runReasoning) in sequence against the
 * testkit fake structured store, and asserts that the pipeline produces
 * a coherent downstream state: facts → entity profile → insight.
 *
 * This is the test that catches the BH-4 (system health audit) class of
 * bug — where the pipeline runs "successfully" (all steps return cleanly)
 * but produces zero insights because of cross-step data flow gaps (e.g.
 * entity name casing mismatch). After v1.2.0's entity-normalisation fix,
 * this integration test should pass without contortion.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Entity, Memory, MaintainDeps } from '@kybernesis/cortex-contracts';
import { createFakeStructuredStore } from '@kybernesis/cortex-testkit/fakes';
import { createMaintain } from './index.js';

const FACT_EXTRACTION_RESPONSE = JSON.stringify([
  {
    content: 'Alice moved from Sweden 4 years ago',
    category: 'biographical',
    confidence: 0.9,
    entities: ['Alice'],
  },
  {
    content: 'Alice works as a software developer',
    category: 'biographical',
    confidence: 0.85,
    entities: ['Alice'],
  },
  {
    content: 'Alice plans to study counseling next year',
    category: 'plan',
    confidence: 0.8,
    entities: ['Alice'],
  },
]);

const PROFILE_RESPONSE = JSON.stringify({
  narrative: 'Alice is a Swedish-origin software developer.',
  staticFacts: [{ value: 'Alice is a developer' }],
});

const REASONING_RESPONSE = JSON.stringify([
  {
    insight: 'Alice is an international developer pursuing career change',
    reasoning: 'Alice moved from Sweden + Alice works as developer + Alice plans counseling study',
    confidence: 0.82,
  },
]);

function makeLLM(): MaintainDeps['llm'] {
  // Sequence: observe extracts facts → profile generates narrative → reasoning deduces.
  let call = 0;
  return {
    model: 'haiku',
    complete: vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) return FACT_EXTRACTION_RESPONSE; // observe
      if (call === 2) return PROFILE_RESPONSE;          // rebuildUserProfile
      return REASONING_RESPONSE;                         // runReasoning (and any further)
    }),
  } as unknown as MaintainDeps['llm'];
}

describe('v1.2.0 e2e pipeline integration', () => {
  it('observe → rebuildUserProfile → runReasoning produces a coherent state', async () => {
    const structured = createFakeStructuredStore();
    await structured.connect();

    // Seed: one Alice entity + one chat memory that mentions her.
    const aliceEntity: Entity = {
      id: 'ent_alice',
      name: 'Alice',
      type: 'person',
      mentionCount: 10,
    };
    await structured.upsertEntity(aliceEntity);

    const chatMemory: Memory = {
      id: 'mem_chat_1',
      title: 'Chat with Alice',
      summary: 'Conversation transcript',
      content:
        'Alice told me she moved here from Sweden four years ago. She is now a developer ' +
        'and plans to study counselling next year as a career change.',
      tags: [],
      priority: 0.7,
      tier: 'warm',
      decayScore: 0,
      accessCount: 1,
      createdAt: new Date().toISOString(),
      isPinned: false,
      contentHash: 'chat-hash',
      source: 'chat',
      status: 'active',
      isLatest: true,
    };
    await structured.storeMemory(chatMemory);

    const deps: MaintainDeps = {
      structured,
      vector: { search: vi.fn(), upsert: vi.fn(), delete: vi.fn() } as unknown as MaintainDeps['vector'],
      embed: { embed: vi.fn().mockResolvedValue([]) } as unknown as MaintainDeps['embed'],
      llm: makeLLM(),
      scheduler: {
        schedule: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn().mockResolvedValue(undefined),
        now: vi.fn().mockReturnValue(new Date()),
      },
      queue: { enqueue: vi.fn(), process: vi.fn() } as unknown as MaintainDeps['queue'],
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const api = createMaintain(deps);

    const result = await api.runSleepPipeline({
      steps: ['observeConversations', 'rebuildUserProfile', 'runReasoning'],
    });

    // (1) All three steps ran (no hard failures swallowed).
    expect(result.stepsRun).toEqual([
      'observeConversations',
      'rebuildUserProfile',
      'runReasoning',
    ]);

    // (2) observeConversations stored facts (entity normalised lowercase).
    const aliceFacts = await structured.getFactsForEntity('Alice');
    expect(aliceFacts.length).toBeGreaterThanOrEqual(1);
    expect(aliceFacts[0]!.entities[0]).toBe('alice'); // normalised at storage

    // (3) rebuildUserProfile stored an EntityProfile for Alice.
    const profile = await structured.getEntityProfile('ent_alice');
    expect(profile).not.toBeNull();

    // (4) runReasoning produced at least one Insight referencing Alice.
    const insights = await structured.listInsights('ent_alice');
    expect(insights.length).toBeGreaterThanOrEqual(1);
  });
});
