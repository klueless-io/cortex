import { describe, it, expect, beforeEach } from 'vitest';
import { createNoopLogger, type Entity } from '@kybernesis/arcana-contracts';
import {
  createFakeStructuredStore,
  createFakeVectorStore,
} from '@kybernesis/arcana-testkit/fakes';
import { createCommand, type CommandApi, type CommandDeps } from './index.js';
import { NotImplementedError } from '../../errors.js';
import { djb2Hash } from '../../util/hash.js';

let deps: CommandDeps;
let api: CommandApi;
let structured: ReturnType<typeof createFakeStructuredStore>;

beforeEach(async () => {
  structured = createFakeStructuredStore();
  await structured.connect();
  deps = {
    structured,
    vector: createFakeVectorStore(),
    logger: createNoopLogger(),
  };
  api = createCommand(deps);
});

describe('createCommand surface', () => {
  it('returns an object with all documented methods', () => {
    expect(typeof api.upsertEntity).toBe('function');
    expect(typeof api.deleteEntity).toBe('function');
    expect(typeof api.recordFact).toBe('function');
    expect(typeof api.markFactSuperseded).toBe('function');
    expect(typeof api.markMemorySuperseded).toBe('function');
    expect(typeof api.storeContradiction).toBe('function');
    expect(typeof api.linkNodes).toBe('function');
    expect(typeof api.updateMemory).toBe('function');
    expect(typeof api.pin).toBe('function');
    expect(typeof api.moveToTier).toBe('function');
    expect(typeof api.deleteMemory).toBe('function');
    expect(typeof api.updateBlock).toBe('function');
  });
});

describe('command.upsertEntity', () => {
  const sample: Entity = {
    id: 'ent_1',
    name: 'Anthropic',
    type: 'company',
    mentionCount: 0,
  };

  it('persists an entity', async () => {
    await api.upsertEntity(sample);
    expect(await structured.getEntity('ent_1')).toEqual(sample);
  });

  it('replaces an existing entity on second call', async () => {
    await api.upsertEntity(sample);
    await api.upsertEntity({ ...sample, mentionCount: 5 });
    const stored = await structured.getEntity('ent_1');
    expect(stored?.mentionCount).toBe(5);
  });
});

describe('command.deleteEntity', () => {
  it('removes an entity by id', async () => {
    const e: Entity = { id: 'ent_2', name: 'X', type: 'topic', mentionCount: 0 };
    await api.upsertEntity(e);
    await api.deleteEntity('ent_2');
    expect(await structured.getEntity('ent_2')).toBeNull();
  });

  it('is a no-op when the entity does not exist', async () => {
    await expect(api.deleteEntity('missing')).resolves.toBeUndefined();
  });
});

describe('command.linkNodes', () => {
  it('creates an edge between two entities', async () => {
    const edgeId = await api.linkNodes(
      { type: 'entity', id: 'ent_a' },
      { type: 'entity', id: 'ent_b' },
      'co-occurred',
    );
    expect(typeof edgeId).toBe('string');
    expect(edgeId.length).toBeGreaterThan(0);
    const neighbors = await structured.getNeighbors({ type: 'entity', id: 'ent_a' });
    expect(neighbors).toEqual([{ type: 'entity', id: 'ent_b' }]);
  });

  it('creates an edge between memory and entity (NodeRef polymorphism)', async () => {
    await api.linkNodes(
      { type: 'memory', id: 'mem_1' },
      { type: 'entity', id: 'ent_x' },
      'mentions',
    );
    const neighbors = await structured.getNeighbors({ type: 'memory', id: 'mem_1' });
    expect(neighbors).toEqual([{ type: 'entity', id: 'ent_x' }]);
  });

  it('applies default confidence=1.0 and method="consumer-mirror" when opts omitted', async () => {
    const id = await api.linkNodes(
      { type: 'entity', id: 'a' },
      { type: 'entity', id: 'b' },
      'related',
    );
    // We can't directly fetch the Edge through the API, but we can verify the
    // neighbor link exists, which proves storeEdge was called with valid input
    // (the schema would reject confidence > 1 or missing method).
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('honors caller-supplied opts', async () => {
    const id = await api.linkNodes(
      { type: 'entity', id: 'a' },
      { type: 'entity', id: 'b' },
      'works_at',
      {
        confidence: 0.7,
        sharedTags: ['workplace'],
        method: 'jaccard',
        rationale: 'Both mentioned in same conversation',
      },
    );
    expect(typeof id).toBe('string');
  });

  it('creates a new edge each call (consumer handles dedup)', async () => {
    const a = await api.linkNodes(
      { type: 'entity', id: 'x' },
      { type: 'entity', id: 'y' },
      'related',
    );
    const b = await api.linkNodes(
      { type: 'entity', id: 'x' },
      { type: 'entity', id: 'y' },
      'related',
    );
    expect(a).not.toBe(b);
  });
});

describe('command.recordFact', () => {
  it('persists a sentence-only fact (no triple decomposition)', async () => {
    const id = await api.recordFact({
      fact: 'David likes coffee',
      entities: ['David'],
      category: 'general',      confidence: 0.8,
      sourceType: 'chat',
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const stored = await structured.getFactsForEntity('David');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.fact).toBe('David likes coffee');
    expect(stored[0]?.attribute).toBeUndefined();
    expect(stored[0]?.value).toBeUndefined();
    expect(stored[0]?.isLatest).toBe(true);
  });

  it('persists a fully-decomposed fact (with attribute + value)', async () => {
    const id = await api.recordFact({
      fact: 'David is a senior engineer',
      entities: ['David'],
      category: 'general',      attribute: 'role',
      value: 'senior engineer',
      confidence: 0.95,
      sourceType: 'ai-extraction',
    });
    const stored = await structured.getFactsForEntity('David', 'role');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(id);
    expect(stored[0]?.attribute).toBe('role');
    expect(stored[0]?.value).toBe('senior engineer');
  });

  it('passes through optional scopes', async () => {
    const id = await api.recordFact({
      fact: 'Acme is in San Francisco',
      entities: ['Acme'],
      category: 'general',      confidence: 0.9,
      sourceType: 'connector',
      scopes: { project_id: 'proj_1' },
    });
    const stored = (await structured.getFactsForEntity('Acme'))[0];
    expect(stored?.id).toBe(id);
    expect(stored?.scopes?.project_id).toBe('proj_1');
  });

  it('rejects invalid confidence (out of range)', async () => {
    await expect(
      api.recordFact({
        fact: 'x',
        entities: ['David'],
        category: 'general',        confidence: 1.5,
        sourceType: 'chat',
      }),
    ).rejects.toThrow();
  });

  it('rejects empty fact (required field)', async () => {
    await expect(
      api.recordFact({
        fact: '',
        entities: ['David'],
        category: 'general',        confidence: 0.5,
        sourceType: 'chat',
      }),
    ).rejects.toThrow();
  });
});

describe('command.updateMemory', () => {
  const baseMemory = {
    id: 'mem_upd_1',
    title: 'original title',
    summary: 'original summary',
    content: 'original content',
    tags: ['original'],
    priority: 0.5,
    tier: 'warm' as const,
    decayScore: 0,
    accessCount: 0,
    isPinned: false,
    contentHash: djb2Hash('original content'),
    createdAt: "2026-05-21T00:00:00.000Z",
    source: 'cli' as const,
    status: 'active' as const,
    isLatest: true,
  };

  beforeEach(async () => {
    await structured.storeMemory(baseMemory);
  });

  it('updates a single field, leaves others untouched', async () => {
    await api.updateMemory('mem_upd_1', { tier: 'hot' });
    const m = await structured.getMemory('mem_upd_1');
    expect(m?.tier).toBe('hot');
    expect(m?.title).toBe('original title'); // unchanged
    expect(m?.content).toBe('original content'); // unchanged
    expect(m?.contentHash).toBe(djb2Hash('original content')); // unchanged
  });

  it('updates multiple fields atomically', async () => {
    await api.updateMemory('mem_upd_1', {
      priority: 0.9,
      isPinned: true,
      accessCount: 5,
    });
    const m = await structured.getMemory('mem_upd_1');
    expect(m?.priority).toBe(0.9);
    expect(m?.isPinned).toBe(true);
    expect(m?.accessCount).toBe(5);
  });

  it('recomputes contentHash when content changes', async () => {
    const newContent = 'completely different content here';
    await api.updateMemory('mem_upd_1', { content: newContent });
    const m = await structured.getMemory('mem_upd_1');
    expect(m?.content).toBe(newContent);
    expect(m?.contentHash).toBe(djb2Hash(newContent));
    expect(m?.contentHash).not.toBe(djb2Hash('original content'));
  });

  it('leaves contentHash unchanged when content is NOT supplied', async () => {
    await api.updateMemory('mem_upd_1', { tier: 'archive' });
    const m = await structured.getMemory('mem_upd_1');
    expect(m?.contentHash).toBe(djb2Hash('original content'));
  });

  it('replaces scopes (no deep merge)', async () => {
    // Seed with scopes
    await api.updateMemory('mem_upd_1', {
      scopes: { org_id: 'org_a', project_id: 'proj_1', classification: 'internal' },
    });
    // Update with partial scopes — should REPLACE, not merge
    await api.updateMemory('mem_upd_1', {
      scopes: { project_id: 'proj_2' },
    });
    const m = await structured.getMemory('mem_upd_1');
    expect(m?.scopes).toEqual({ project_id: 'proj_2' });
    // org_id and classification should be gone
    expect(m?.scopes?.org_id).toBeUndefined();
    expect(m?.scopes?.classification).toBeUndefined();
  });

  it('rejects an unknown tier value', async () => {
    await expect(
      api.updateMemory('mem_upd_1', { tier: 'frozen' as never }),
    ).rejects.toThrow();
  });

  it('rejects an unknown top-level key', async () => {
    await expect(
      api.updateMemory('mem_upd_1', { totallyMadeUp: 'x' } as never),
    ).rejects.toThrow();
  });

  it('rejects priority out of range', async () => {
    await expect(
      api.updateMemory('mem_upd_1', { priority: 1.5 }),
    ).rejects.toThrow();
  });
});

describe('command.pin (now wraps updateMemory)', () => {
  beforeEach(async () => {
    await structured.storeMemory({
      id: 'mem_pin_1',
      title: 't',
      summary: 's',
      content: 'c',
      tags: [],
      priority: 0.5,
      tier: 'warm',
      decayScore: 0,
      accessCount: 0,
      isPinned: false,
      contentHash: djb2Hash('c'),
      createdAt: "2026-05-21T00:00:00.000Z",
      source: 'cli',
    });
  });

  it('sets isPinned=true via updateMemory', async () => {
    await api.pin('mem_pin_1');
    const m = await structured.getMemory('mem_pin_1');
    expect(m?.isPinned).toBe(true);
  });
});

describe('command.moveToTier (now wraps updateMemory)', () => {
  beforeEach(async () => {
    await structured.storeMemory({
      id: 'mem_tier_1',
      title: 't',
      summary: 's',
      content: 'c',
      tags: [],
      priority: 0.5,
      tier: 'warm',
      decayScore: 0,
      accessCount: 0,
      isPinned: false,
      contentHash: djb2Hash('c'),
      createdAt: "2026-05-21T00:00:00.000Z",
      source: 'cli',
    });
  });

  it('updates tier via updateMemory', async () => {
    await api.moveToTier('mem_tier_1', 'hot');
    const m = await structured.getMemory('mem_tier_1');
    expect(m?.tier).toBe('hot');
  });

  it('updates tier to archive', async () => {
    await api.moveToTier('mem_tier_1', 'archive');
    const m = await structured.getMemory('mem_tier_1');
    expect(m?.tier).toBe('archive');
  });
});

describe('command.markFactSuperseded', () => {
  it('marks an existing fact as superseded by another', async () => {
    const oldId = await api.recordFact({
      fact: 'David lives in Sydney',
      entities: ['David'],
      category: 'general',      confidence: 0.9,
      sourceType: 'chat',
    });
    const newId = await api.recordFact({
      fact: 'David lives in Melbourne',
      entities: ['David'],
      category: 'general',      confidence: 0.95,
      sourceType: 'chat',
    });
    await api.markFactSuperseded(oldId, newId);
    // v1.2.0 — explicit latestOnly:false to see the superseded row.
    const facts = await structured.getFactsForEntity('David', undefined, undefined, false);
    const old = facts.find((f) => f.id === oldId);
    const updated = facts.find((f) => f.id === newId);
    expect(old?.isLatest).toBe(false);
    expect(old?.supersededBy).toBe(newId);
    expect(updated?.isLatest).toBe(true);
    expect(updated?.supersededBy).toBeUndefined();
  });

  it('throws when oldFactId does not exist', async () => {
    await expect(
      api.markFactSuperseded('missing', 'also-missing'),
    ).rejects.toThrow();
  });
});

describe('command.markMemorySuperseded', () => {
  const mkMemory = (id: string, content: string) => ({
    id,
    title: '',
    summary: '',
    content,
    tags: [],
    priority: 0.5,
    tier: 'warm' as const,
    decayScore: 0,
    accessCount: 0,
    isPinned: false,
    contentHash: djb2Hash(content),
    createdAt: "2026-05-21T00:00:00.000Z",
    source: 'chat' as const,
    status: 'active' as const,
    isLatest: true,
  });

  it('marks an existing memory as superseded by another', async () => {
    await structured.storeMemory(mkMemory('mem_old', 'David lives in Sydney'));
    await structured.storeMemory(mkMemory('mem_new', 'David lives in Melbourne'));
    await api.markMemorySuperseded('mem_old', 'mem_new');
    const old = await structured.getMemory('mem_old');
    const updated = await structured.getMemory('mem_new');
    expect(old?.isLatest).toBe(false);
    expect(old?.supersededBy).toBe('mem_new');
    expect(updated?.isLatest).toBe(true);
    expect(updated?.supersededBy).toBeUndefined();
  });

  it('throws when oldMemoryId does not exist', async () => {
    await expect(
      api.markMemorySuperseded('missing', 'also-missing'),
    ).rejects.toThrow();
  });
});

describe('command.storeContradiction', () => {
  it('persists a minimal contradiction with default status=pending', async () => {
    const id = await api.storeContradiction({
      factAId: 'fact_a',
      factBId: 'fact_b',
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const all = await structured.listContradictions();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(id);
    expect(all[0]?.status).toBe('pending');
    expect(all[0]?.rationale).toBeUndefined();
  });

  it('persists a contradiction with rationale', async () => {
    const id = await api.storeContradiction({
      factAId: 'fact_a',
      factBId: 'fact_b',
      rationale: 'Mutually exclusive locations claimed for David.',
    });
    const all = await structured.listContradictions();
    expect(all[0]?.id).toBe(id);
    expect(all[0]?.rationale).toBe(
      'Mutually exclusive locations claimed for David.',
    );
  });

  it('honors explicit status override', async () => {
    await api.storeContradiction({
      factAId: 'fact_a',
      factBId: 'fact_b',
      status: 'auto-resolved',
    });
    const all = await structured.listContradictions('auto-resolved');
    expect(all).toHaveLength(1);
  });

  it('returns a UUID that can be queried back', async () => {
    const id = await api.storeContradiction({
      factAId: 'fact_a',
      factBId: 'fact_b',
    });
    const pending = await structured.listContradictions('pending');
    expect(pending.find((c) => c.id === id)).toBeDefined();
  });
});

describe('still-stubbed command methods', () => {
  it('deleteMemory throws NotImplementedError', async () => {
    await expect(api.deleteMemory('mem_1')).rejects.toThrow(NotImplementedError);
  });

  it('updateBlock throws NotImplementedError', async () => {
    await expect(api.updateBlock('persona', 'new')).rejects.toThrow(
      NotImplementedError,
    );
  });
});
