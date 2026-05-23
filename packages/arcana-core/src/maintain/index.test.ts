import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMaintain,
  SLEEP_STEPS,
  type MaintainDeps,
  type SleepStep,
} from './index.js';
import type {
  Memory,
  Entity,
  StructuredStore,
  Scheduler,
  Logger,
} from '@kybernesis/arcana-contracts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-1',
    title: 'Test memory',
    summary: 'A summary',
    content: 'Some content for testing',
    tags: ['alpha', 'beta'],
    priority: 0.5,
    tier: 'warm',
    decayScore: 0.1,
    accessCount: 3,
    createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    isPinned: false,
    contentHash: 'abc123',
    source: 'chat',
    status: 'active',
    isLatest: true,
    ...overrides,
  };
}

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'ent-1',
    name: 'Alice',
    type: 'person',
    mentionCount: 5,
    ...overrides,
  };
}

function makeStructured(overrides: Partial<StructuredStore> = {}): StructuredStore {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    storeMemory: vi.fn(),
    getMemory: vi.fn().mockResolvedValue(null),
    listMemories: vi.fn().mockResolvedValue([]),
    updateMemory: vi.fn().mockResolvedValue(undefined),
    markMemorySuperseded: vi.fn(),
    deleteMemory: vi.fn().mockResolvedValue(undefined),
    storeChunks: vi.fn(),
    getChunksForMemory: vi.fn().mockResolvedValue([]),
    upsertEntity: vi.fn(),
    getEntity: vi.fn().mockResolvedValue(null),
    listEntities: vi.fn().mockResolvedValue([]),
    deleteEntity: vi.fn().mockResolvedValue(undefined),
    storeEdge: vi.fn().mockResolvedValue(undefined),
    getNeighbors: vi.fn().mockResolvedValue([]),
    storeFact: vi.fn().mockResolvedValue(undefined),
    getFact: vi.fn().mockResolvedValue(null),
    getFactsForEntity: vi.fn().mockResolvedValue([]),
    markFactSuperseded: vi.fn(),
    searchFulltext: vi.fn().mockResolvedValue([]),
    searchFactsFulltext: vi.fn().mockResolvedValue([]),
    storeContradiction: vi.fn(),
    listContradictions: vi.fn().mockResolvedValue([]),
    storeInsight: vi.fn().mockResolvedValue(undefined),
    listInsights: vi.fn().mockResolvedValue([]),
    storeEntityProfile: vi.fn().mockResolvedValue(undefined),
    getEntityProfile: vi.fn().mockResolvedValue(null),
    getAgentSelf: vi.fn().mockResolvedValue(null),
    updateAgentSelf: vi.fn(),
    ...overrides,
  } as unknown as StructuredStore;
}

function makeScheduler(): Scheduler {
  return {
    schedule: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    now: vi.fn().mockReturnValue(new Date()),
  };
}

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeDeps(overrides: Partial<MaintainDeps> = {}): MaintainDeps {
  return {
    structured: makeStructured(),
    vector: { search: vi.fn(), upsert: vi.fn(), delete: vi.fn() } as unknown as MaintainDeps['vector'],
    embed: { embed: vi.fn().mockResolvedValue([]) } as unknown as MaintainDeps['embed'],
    llm: { model: 'haiku', complete: vi.fn().mockResolvedValue('[]') } as unknown as MaintainDeps['llm'],
    scheduler: makeScheduler(),
    queue: { enqueue: vi.fn(), process: vi.fn() } as unknown as MaintainDeps['queue'],
    logger: makeLogger(),
    ...overrides,
  };
}

// ── SLEEP_STEPS ───────────────────────────────────────────────────────────────

describe('SLEEP_STEPS', () => {
  it('has exactly 10 steps in KB execution order', () => {
    expect(SLEEP_STEPS).toHaveLength(10);
    expect(SLEEP_STEPS[0]).toBe('decayMemories');
    expect(SLEEP_STEPS[9]).toBe('cleanEntityGraph');
  });

  it('matches KB pipeline order verbatim', () => {
    expect(SLEEP_STEPS).toEqual([
      'decayMemories',
      'refreshTags',
      'consolidateMemories',
      'linkMemories',
      'tierMemories',
      'summarizeMemories',
      'observeConversations',
      'rebuildUserProfile',
      'runReasoning',
      'cleanEntityGraph',
    ]);
  });
});

// ── Orchestrator ──────────────────────────────────────────────────────────────

describe('createMaintain — orchestrator', () => {
  it('returns the three documented API methods', () => {
    const api = createMaintain(makeDeps());
    expect(typeof api.runSleepPipeline).toBe('function');
    expect(typeof api.startSleepSchedule).toBe('function');
    expect(typeof api.stopSleepSchedule).toBe('function');
  });

  it('runSleepPipeline returns SleepRunResult shape', async () => {
    const api = createMaintain(makeDeps());
    const result = await api.runSleepPipeline();
    expect(typeof result.startedAt).toBe('string');
    expect(typeof result.finishedAt).toBe('string');
    expect(Array.isArray(result.stepsRun)).toBe(true);
    expect(typeof result.candidatesProcessed).toBe('number');
  });

  it('runs all 10 steps by default', async () => {
    const api = createMaintain(makeDeps());
    const result = await api.runSleepPipeline();
    expect(result.stepsRun).toHaveLength(10);
  });

  it('respects input.steps filter', async () => {
    const api = createMaintain(makeDeps());
    const result = await api.runSleepPipeline({
      steps: ['decayMemories', 'tierMemories'],
    });
    expect(result.stepsRun).toEqual(['decayMemories', 'tierMemories']);
  });

  it('continues past a failing step', async () => {
    const structured = makeStructured({
      listMemories: vi
        .fn()
        .mockRejectedValueOnce(new Error('DB down'))
        .mockResolvedValue([]),
    });
    const deps = makeDeps({ structured });
    const api = createMaintain(deps);
    const result = await api.runSleepPipeline({
      steps: ['decayMemories', 'tierMemories'],
    });
    // tierMemories still ran even though decayMemories threw
    expect(result.stepsRun).toContain('tierMemories');
  });

  it('startSleepSchedule delegates to scheduler.schedule', async () => {
    const scheduler = makeScheduler();
    const api = createMaintain(makeDeps({ scheduler }));
    await api.startSleepSchedule(60_000);
    expect(scheduler.schedule).toHaveBeenCalledWith(
      'arcana:sleep-pipeline',
      60_000,
      expect.any(Function),
    );
  });

  it('stopSleepSchedule delegates to scheduler.cancel', async () => {
    const scheduler = makeScheduler();
    const api = createMaintain(makeDeps({ scheduler }));
    await api.stopSleepSchedule();
    expect(scheduler.cancel).toHaveBeenCalledWith('arcana:sleep-pipeline');
  });

  // ── v1.2.0 — single-flight + partial-failure ───────────────────────────────

  it('concurrent runSleepPipeline calls share the same in-flight promise (single-flight)', async () => {
    let listMemoriesCalls = 0;
    const structured = makeStructured({
      listMemories: vi.fn().mockImplementation(async () => {
        listMemoriesCalls++;
        // Slow this step so the second call definitely overlaps.
        await new Promise((r) => setTimeout(r, 10));
        return [];
      }),
    });
    const api = createMaintain(makeDeps({ structured }));
    const [a, b] = await Promise.all([
      api.runSleepPipeline({ steps: ['decayMemories'] }),
      api.runSleepPipeline({ steps: ['decayMemories'] }),
    ]);
    // Only one underlying execution: listMemories called exactly once.
    expect(listMemoriesCalls).toBe(1);
    // Both callers got the same SleepRunResult instance.
    expect(a).toBe(b);
  });

  it('marks step partial when result has non-empty errors[]', async () => {
    // refreshTags returns errors[] when LLM call fails — simulate by making
    // updateMemory throw, which the step catches and pushes to errors[].
    const memory = makeMemory({ tags: [], title: 'long title here that exceeds the fifty character minimum threshold for tagging', summary: 'long summary that also definitely passes the fifty character minimum threshold' });
    const structured = makeStructured({
      listMemories: vi.fn().mockResolvedValue([memory]),
      updateMemory: vi.fn().mockRejectedValue(new Error('DB write failed')),
    });
    const llm = { model: 'haiku', complete: vi.fn().mockResolvedValue('["ai","testing"]') } as unknown as MaintainDeps['llm'];
    const api = createMaintain(makeDeps({ structured, llm }));
    const result = await api.runSleepPipeline({ steps: ['refreshTags'] });
    expect(result.partialSteps).toEqual(['refreshTags']);
  });

  it('resume retries partial steps (does not skip them)', async () => {
    const memory = makeMemory({ tags: [], title: 'long title here that exceeds the fifty character minimum threshold for tagging', summary: 'long summary that also definitely passes the fifty character minimum threshold' });
    const llmCalls = vi.fn().mockResolvedValue('["ai","testing"]');
    const structured = makeStructured({
      listMemories: vi.fn().mockResolvedValue([memory]),
      updateMemory: vi.fn().mockRejectedValue(new Error('DB write failed')),
    });
    const llm = { model: 'haiku', complete: llmCalls } as unknown as MaintainDeps['llm'];
    const api = createMaintain(makeDeps({ structured, llm }));
    const r1 = await api.runSleepPipeline({ steps: ['refreshTags'] });
    expect(r1.partialSteps).toEqual(['refreshTags']);
    const r2 = await api.runSleepPipeline({ steps: ['refreshTags'], resume: true });
    expect(r2.stepsRun).toEqual(['refreshTags']);
    // Re-attempted: LLM called twice across both runs.
    expect(llmCalls).toHaveBeenCalledTimes(2);
  });

  it('SleepRunResult always includes partialSteps array (empty when clean)', async () => {
    const api = createMaintain(makeDeps());
    const result = await api.runSleepPipeline({ steps: ['decayMemories'] });
    expect(Array.isArray(result.partialSteps)).toBe(true);
    expect(result.partialSteps).toEqual([]);
  });

  it('single-flight: after first run settles, a new call starts a fresh run', async () => {
    let listMemoriesCalls = 0;
    const structured = makeStructured({
      listMemories: vi.fn().mockImplementation(async () => {
        listMemoriesCalls++;
        return [];
      }),
    });
    const api = createMaintain(makeDeps({ structured }));
    await api.runSleepPipeline({ steps: ['decayMemories'] });
    await api.runSleepPipeline({ steps: ['decayMemories'] });
    // Two separate runs => listMemories called twice (running cleared after first).
    expect(listMemoriesCalls).toBe(2);
  });
});

// ── Mechanical steps ──────────────────────────────────────────────────────────

describe('decayMemories step', () => {
  it('updates decayScore and priority for non-pinned old memories', async () => {
    const memory = makeMemory({
      decayScore: 0,
      priority: 1,
      accessCount: 0,
      createdAt: new Date(Date.now() - 720 * 60 * 60 * 1000).toISOString(), // 30 days old
    });
    const structured = makeStructured({ listMemories: vi.fn().mockResolvedValue([memory]) });
    const api = createMaintain(makeDeps({ structured }));
    await api.runSleepPipeline({ steps: ['decayMemories'] });
    expect(structured.updateMemory).toHaveBeenCalledWith(
      memory.id,
      expect.objectContaining({ decayScore: expect.any(Number), priority: expect.any(Number) }),
    );
  });

  it('skips pinned memories', async () => {
    const pinned = makeMemory({ isPinned: true });
    const structured = makeStructured({ listMemories: vi.fn().mockResolvedValue([pinned]) });
    const api = createMaintain(makeDeps({ structured }));
    await api.runSleepPipeline({ steps: ['decayMemories'] });
    expect(structured.updateMemory).not.toHaveBeenCalled();
  });
});

describe('consolidateMemories step', () => {
  it('deletes duplicate memories keeping the newest', async () => {
    const base = makeMemory({ title: 'Daily standup', isPinned: false });
    const older = { ...base, id: 'mem-old', createdAt: new Date(Date.now() - 200_000).toISOString() };
    const older2 = { ...base, id: 'mem-older2', createdAt: new Date(Date.now() - 100_000).toISOString() };
    const newest = { ...base, id: 'mem-new', createdAt: new Date().toISOString() };
    const structured = makeStructured({
      listMemories: vi.fn().mockResolvedValue([older, older2, newest]),
      deleteMemory: vi.fn().mockResolvedValue(undefined),
    });
    const api = createMaintain(makeDeps({ structured }), { consolidationTitleThreshold: 3 });
    await api.runSleepPipeline({ steps: ['consolidateMemories'] });
    expect(structured.deleteMemory).toHaveBeenCalledWith(older.id);
    expect(structured.deleteMemory).toHaveBeenCalledWith(older2.id);
    expect(structured.deleteMemory).not.toHaveBeenCalledWith(newest.id);
  });

  it('is a no-op when consolidation is disabled', async () => {
    const structured = makeStructured({ listMemories: vi.fn().mockResolvedValue([makeMemory()]) });
    const api = createMaintain(makeDeps({ structured }), { enableConsolidation: false });
    await api.runSleepPipeline({ steps: ['consolidateMemories'] });
    expect(structured.deleteMemory).not.toHaveBeenCalled();
  });
});

describe('tierMemories step', () => {
  it('promotes a high-priority low-decay recent memory to hot', async () => {
    const memory = makeMemory({
      priority: 0.8,
      decayScore: 0.1,
      tier: 'warm',
      lastAccessedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h ago
      accessCount: 10,
    });
    const structured = makeStructured({ listMemories: vi.fn().mockResolvedValue([memory]) });
    const api = createMaintain(makeDeps({ structured }));
    await api.runSleepPipeline({ steps: ['tierMemories'] });
    expect(structured.updateMemory).toHaveBeenCalledWith(memory.id, { tier: 'hot' });
  });

  it('archives a low-priority high-decay memory', async () => {
    const memory = makeMemory({
      priority: 0.1,
      decayScore: 0.9,
      tier: 'warm',
      lastAccessedAt: undefined,
      accessCount: 0,
    });
    const structured = makeStructured({ listMemories: vi.fn().mockResolvedValue([memory]) });
    const api = createMaintain(makeDeps({ structured }));
    await api.runSleepPipeline({ steps: ['tierMemories'] });
    expect(structured.updateMemory).toHaveBeenCalledWith(memory.id, { tier: 'archive' });
  });

  it('skips pinned memories', async () => {
    const pinned = makeMemory({ isPinned: true, priority: 0.1, decayScore: 0.9 });
    const structured = makeStructured({ listMemories: vi.fn().mockResolvedValue([pinned]) });
    const api = createMaintain(makeDeps({ structured }));
    await api.runSleepPipeline({ steps: ['tierMemories'] });
    expect(structured.updateMemory).not.toHaveBeenCalled();
  });
});

describe('cleanEntityGraph step', () => {
  it('deletes artifact entities', async () => {
    const speaker = makeEntity({ name: 'Speaker 0' });
    const structured = makeStructured({
      listEntities: vi.fn().mockResolvedValue([speaker]),
      deleteEntity: vi.fn().mockResolvedValue(undefined),
    });
    const api = createMaintain(makeDeps({ structured }));
    await api.runSleepPipeline({ steps: ['cleanEntityGraph'] });
    expect(structured.deleteEntity).toHaveBeenCalledWith(speaker.id);
  });

  it('prunes low-mention entities with no facts', async () => {
    const noise = makeEntity({ name: 'RandomThing', mentionCount: 1 });
    const structured = makeStructured({
      listEntities: vi.fn().mockResolvedValue([noise]),
      getFactsForEntity: vi.fn().mockResolvedValue([]),
      deleteEntity: vi.fn().mockResolvedValue(undefined),
    });
    const api = createMaintain(makeDeps({ structured }));
    await api.runSleepPipeline({ steps: ['cleanEntityGraph'] });
    expect(structured.deleteEntity).toHaveBeenCalledWith(noise.id);
  });

  it('keeps low-mention entities that have facts', async () => {
    const entity = makeEntity({ mentionCount: 1 });
    const structured = makeStructured({
      listEntities: vi.fn().mockResolvedValue([entity]),
      getFactsForEntity: vi.fn().mockResolvedValue([{ id: 'f1', fact: 'Alice is a developer', entities: ['Alice'], confidence: 0.9, category: 'biographical', sourceType: 'ai-extraction', isLatest: true, createdAt: new Date().toISOString() }]),
      deleteEntity: vi.fn().mockResolvedValue(undefined),
    });
    const api = createMaintain(makeDeps({ structured }));
    await api.runSleepPipeline({ steps: ['cleanEntityGraph'] });
    expect(structured.deleteEntity).not.toHaveBeenCalled();
  });

  it('is a no-op when entity hygiene is disabled', async () => {
    const structured = makeStructured({ listEntities: vi.fn().mockResolvedValue([makeEntity()]) });
    const api = createMaintain(makeDeps({ structured }), { enableEntityHygiene: false });
    await api.runSleepPipeline({ steps: ['cleanEntityGraph'] });
    expect(structured.deleteEntity).not.toHaveBeenCalled();
  });
});

// ── LLM steps (mock LLM) ──────────────────────────────────────────────────────

describe('refreshTags step (LLM)', () => {
  it('calls llm.complete and updates memory tags', async () => {
    const memory = makeMemory({ tags: [], title: 'Alice discussed her project plans and timelines with the team during the weekly standup', summary: 'Key decisions were made about the upcoming release schedule and resource allocation for Q3.' }); // no tags, long content → eligible
    const structured = makeStructured({ listMemories: vi.fn().mockResolvedValue([memory]) });
    const llm = { model: 'haiku', complete: vi.fn().mockResolvedValue('["ai", "testing", "code"]') } as unknown as MaintainDeps['llm'];
    const api = createMaintain(makeDeps({ structured, llm }));
    await api.runSleepPipeline({ steps: ['refreshTags'] });
    expect(llm.complete).toHaveBeenCalled();
    expect(structured.updateMemory).toHaveBeenCalledWith(memory.id, expect.objectContaining({ tags: expect.any(Array) }));
  });

  it('is a no-op when enableTagging is false', async () => {
    const llm = { model: 'haiku', complete: vi.fn() } as unknown as MaintainDeps['llm'];
    const api = createMaintain(makeDeps({ llm }), { enableTagging: false });
    await api.runSleepPipeline({ steps: ['refreshTags'] });
    expect(llm.complete).not.toHaveBeenCalled();
  });
});

describe('summarizeMemories step (LLM)', () => {
  it('calls llm.complete and updates memory summary', async () => {
    const memory = makeMemory({ summary: '' }); // empty summary → needs one
    const structured = makeStructured({ listMemories: vi.fn().mockResolvedValue([memory]) });
    const llm = { model: 'haiku', complete: vi.fn().mockResolvedValue('Alice discussed her project plans with the team.') } as unknown as MaintainDeps['llm'];
    const api = createMaintain(makeDeps({ structured, llm }));
    await api.runSleepPipeline({ steps: ['summarizeMemories'] });
    expect(llm.complete).toHaveBeenCalled();
    expect(structured.updateMemory).toHaveBeenCalledWith(
      memory.id,
      expect.objectContaining({ summary: expect.any(String) }),
    );
  });

  it('skips memories with adequate summaries', async () => {
    const memory = makeMemory({ summary: 'A perfectly fine summary that is definitely long enough to pass the fifty character minimum threshold check.' });
    const structured = makeStructured({ listMemories: vi.fn().mockResolvedValue([memory]) });
    const llm = { model: 'haiku', complete: vi.fn() } as unknown as MaintainDeps['llm'];
    const api = createMaintain(makeDeps({ structured, llm }));
    await api.runSleepPipeline({ steps: ['summarizeMemories'] });
    expect(llm.complete).not.toHaveBeenCalled();
  });
});

describe('observeConversations step (LLM)', () => {
  it('extracts facts from chat memories and stores them', async () => {
    const chatMemory = makeMemory({ source: 'chat', content: 'Alice said she moved from Sweden four years ago and now works as a developer in Sydney.' });
    const structured = makeStructured({
      listMemories: vi.fn().mockResolvedValue([chatMemory]),
      storeFact: vi.fn().mockResolvedValue(undefined),
    });
    const llm = {
      model: 'haiku',
      complete: vi.fn().mockResolvedValue('[{"content":"Alice moved from Sweden 4 years ago","category":"biographical","confidence":0.9,"entities":["Alice"]}]'),
    } as unknown as MaintainDeps['llm'];
    const api = createMaintain(makeDeps({ structured, llm }));
    await api.runSleepPipeline({ steps: ['observeConversations'] });
    expect(structured.storeFact).toHaveBeenCalledWith(
      expect.objectContaining({ fact: 'Alice moved from Sweden 4 years ago', category: 'biographical' }),
    );
  });

  it('is a no-op when enableFactExtraction is false', async () => {
    const structured = makeStructured({ storeFact: vi.fn() });
    const api = createMaintain(makeDeps({ structured }), { enableFactExtraction: false });
    await api.runSleepPipeline({ steps: ['observeConversations'] });
    expect(structured.storeFact).not.toHaveBeenCalled();
  });
});

describe('rebuildUserProfile step (LLM)', () => {
  it('skips when no entities exist', async () => {
    const structured = makeStructured({ listEntities: vi.fn().mockResolvedValue([]) });
    const llm = { model: 'haiku', complete: vi.fn() } as unknown as MaintainDeps['llm'];
    const api = createMaintain(makeDeps({ structured, llm }));
    await api.runSleepPipeline({ steps: ['rebuildUserProfile'] });
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('stores entity profile for top entity when facts exist', async () => {
    const entity = makeEntity({ mentionCount: 10 });
    const facts = [{ id: 'f1', fact: 'Alice is a developer', entities: ['Alice'], confidence: 0.9, category: 'biographical' as const, sourceType: 'ai-extraction' as const, isLatest: true, createdAt: new Date().toISOString() }];
    const structured = makeStructured({
      listEntities: vi.fn().mockResolvedValue([entity]),
      getEntityProfile: vi.fn().mockResolvedValue(null),
      getFactsForEntity: vi.fn().mockResolvedValue(facts),
      storeEntityProfile: vi.fn().mockResolvedValue(undefined),
    });
    const llm = { model: 'haiku', complete: vi.fn().mockResolvedValue('{"narrative":"Alice is a developer.","staticFacts":[{"value":"Alice is a developer"}]}') } as unknown as MaintainDeps['llm'];
    const api = createMaintain(makeDeps({ structured, llm }), { enableUserProfile: true });
    await api.runSleepPipeline({ steps: ['rebuildUserProfile'] });
    expect(structured.storeEntityProfile).toHaveBeenCalled();
  });
});

describe('runReasoning step (LLM)', () => {
  it('generates insights for entities with 3+ mentions', async () => {
    const entity = makeEntity({ mentionCount: 5 });
    const facts = [
      { id: 'f1', fact: 'Alice is a developer', entities: ['Alice'], confidence: 0.9, category: 'biographical' as const, sourceType: 'ai-extraction' as const, isLatest: true, createdAt: new Date().toISOString() },
      { id: 'f2', fact: 'Alice works at Acme', entities: ['Alice'], confidence: 0.85, category: 'biographical' as const, sourceType: 'ai-extraction' as const, isLatest: true, createdAt: new Date().toISOString() },
      { id: 'f3', fact: 'Alice moved from Sweden', entities: ['Alice'], confidence: 0.9, category: 'biographical' as const, sourceType: 'ai-extraction' as const, isLatest: true, createdAt: new Date().toISOString() },
    ];
    const structured = makeStructured({
      listEntities: vi.fn().mockResolvedValue([entity]),
      getFactsForEntity: vi.fn().mockResolvedValue(facts),
      storeInsight: vi.fn().mockResolvedValue(undefined),
    });
    const llm = {
      model: 'haiku',
      complete: vi.fn().mockResolvedValue('[{"insight":"Alice is an international developer","reasoning":"Alice is a developer + Alice moved from Sweden","confidence":0.85}]'),
    } as unknown as MaintainDeps['llm'];
    const api = createMaintain(makeDeps({ structured, llm }), { enableReasoning: true, maxReasoningPerRun: 5 });
    await api.runSleepPipeline({ steps: ['runReasoning'] });
    expect(structured.storeInsight).toHaveBeenCalled();
  });

  it('is a no-op when reasoning is disabled', async () => {
    const structured = makeStructured({ storeInsight: vi.fn() });
    const api = createMaintain(makeDeps({ structured }), { enableReasoning: false });
    await api.runSleepPipeline({ steps: ['runReasoning'] });
    expect(structured.storeInsight).not.toHaveBeenCalled();
  });
});
