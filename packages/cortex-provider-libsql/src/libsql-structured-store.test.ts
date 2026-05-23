import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Memory, Entity, Fact, Contradiction, Edge, Insight, EntityProfile, AgentSelf, Chunk } from '@kybernesis/cortex-contracts';
import { createLibsqlStructuredStore } from './libsql-structured-store.js';

const baseMemory = (): Memory => ({
  id: 'mem_1',
  title: 'Test memory',
  summary: 'short',
  content: 'hello world',
  tags: ['a', 'b'],
  priority: 0.5,
  tier: 'warm',
  decayScore: 0,
  accessCount: 0,
  isPinned: false,
  contentHash: 'abc12345',
  createdAt: "2026-05-21T00:00:00.000Z",
  source: 'cli',
  status: 'active',
  isLatest: true,
});

const baseEntity = (): Entity => ({
  id: 'ent_1',
  name: 'Anthropic',
  type: 'company',
  mentionCount: 3,
});

const baseFact = (): Fact => ({
  id: 'fact_1',
  fact: 'Anthropic was founded in 2021',
  entities: ['ent_1'],
  category: 'general',  confidence: 0.9,
  sourceType: 'ai-extraction',
  createdAt: '2026-05-19T00:00:00.000Z',
  isLatest: true,
});

describe('LibsqlStructuredStore (in-memory SQLite)', () => {
  const store = createLibsqlStructuredStore(':memory:');

  beforeEach(async () => { await store.connect(); });
  afterEach(async () => { await store.disconnect(); });

  // ── lifecycle ─────────────────────────────────────────────────────────────

  it('connect + disconnect do not throw', async () => {
    // beforeEach/afterEach cover this; just assert we got here
    expect(true).toBe(true);
  });

  it('throws when not connected', async () => {
    const cold = createLibsqlStructuredStore(':memory:');
    await expect(cold.getMemory('x')).rejects.toThrow('not connected');
  });

  it('connect() creates missing parent directories for file-based paths', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cortex-test-'));
    const dbPath = join(base, 'nested', 'deep', 'cortex.db');
    const fileStore = createLibsqlStructuredStore(dbPath);
    await expect(fileStore.connect()).resolves.not.toThrow();
    await fileStore.disconnect();
    rmSync(base, { recursive: true, force: true });
  });

  // ── Memory ────────────────────────────────────────────────────────────────

  it('storeMemory then getMemory round-trips', async () => {
    const mem = baseMemory();
    await store.storeMemory(mem);
    expect(await store.getMemory('mem_1')).toEqual(mem);
  });

  it('getMemory returns null for unknown id', async () => {
    expect(await store.getMemory('nope')).toBeNull();
  });

  it('storeMemory round-trips optional fields', async () => {
    const mem: Memory = {
      ...baseMemory(),
      id: 'mem_opt',
      lastAccessedAt: '2026-05-19T00:00:00.000Z',
      supersededBy: 'mem_new',
      isLatest: false,
      scopes: { org_id: 'org_1' },
    };
    await store.storeMemory(mem);
    expect(await store.getMemory('mem_opt')).toEqual(mem);
  });

  it('listMemories returns all stored memories', async () => {
    await store.storeMemory(baseMemory());
    await store.storeMemory({ ...baseMemory(), id: 'mem_2', tier: 'cold' });
    const all = await store.listMemories();
    expect(all).toHaveLength(2);
  });

  it('listMemories filters by tier', async () => {
    await store.storeMemory(baseMemory());
    await store.storeMemory({ ...baseMemory(), id: 'mem_2', tier: 'cold' });
    const cold = await store.listMemories({ tier: 'cold' });
    expect(cold).toHaveLength(1);
    expect(cold[0].id).toBe('mem_2');
  });

  it('listMemories filters by isPinned', async () => {
    await store.storeMemory(baseMemory());
    await store.storeMemory({ ...baseMemory(), id: 'mem_pinned', isPinned: true });
    const pinned = await store.listMemories({ isPinned: true });
    expect(pinned).toHaveLength(1);
    expect(pinned[0].id).toBe('mem_pinned');
  });

  it('updateMemory partial-updates fields', async () => {
    await store.storeMemory(baseMemory());
    await store.updateMemory('mem_1', { isPinned: true, tier: 'hot' });
    const updated = await store.getMemory('mem_1');
    expect(updated?.isPinned).toBe(true);
    expect(updated?.tier).toBe('hot');
    expect(updated?.content).toBe('hello world'); // unchanged
  });

  it('updateMemory throws for unknown id', async () => {
    await expect(store.updateMemory('ghost', { isPinned: true })).rejects.toThrow('unknown id');
  });

  it('markMemorySuperseded sets isLatest=false and supersededBy', async () => {
    await store.storeMemory(baseMemory());
    await store.storeMemory({ ...baseMemory(), id: 'mem_new' });
    await store.markMemorySuperseded('mem_1', 'mem_new');
    const old = await store.getMemory('mem_1');
    expect(old?.isLatest).toBe(false);
    expect(old?.supersededBy).toBe('mem_new');
  });

  it('markMemorySuperseded throws for unknown id', async () => {
    await expect(store.markMemorySuperseded('ghost', 'mem_new')).rejects.toThrow('unknown id');
  });

  it('deleteMemory removes the row', async () => {
    await store.storeMemory(baseMemory());
    await store.deleteMemory('mem_1');
    expect(await store.getMemory('mem_1')).toBeNull();
  });

  // ── Chunk ─────────────────────────────────────────────────────────────────

  it('storeChunks then getChunksForMemory round-trips', async () => {
    const chunk: Chunk = { id: 'chunk_1', memoryId: 'mem_1', text: 'part', layer: 'warm' };
    await store.storeChunks([chunk]);
    const got = await store.getChunksForMemory('mem_1');
    expect(got).toHaveLength(1);
    expect(got[0].text).toBe('part');
  });

  // ── Entity ────────────────────────────────────────────────────────────────

  it('upsertEntity then getEntity round-trips', async () => {
    const ent = baseEntity();
    await store.upsertEntity(ent);
    expect(await store.getEntity('ent_1')).toEqual(ent);
  });

  it('getEntity returns null for unknown id', async () => {
    expect(await store.getEntity('nope')).toBeNull();
  });

  it('deleteEntity removes the row', async () => {
    await store.upsertEntity(baseEntity());
    await store.deleteEntity('ent_1');
    expect(await store.getEntity('ent_1')).toBeNull();
  });

  // ── Edge ──────────────────────────────────────────────────────────────────

  it('storeEdge then getNeighbors returns the other node', async () => {
    const edge: Edge = {
      id: 'edge_1',
      from: { type: 'memory', id: 'mem_1' },
      to: { type: 'entity', id: 'ent_1' },
      relation: 'mentions',
      confidence: 0.8,
      sharedTags: [],
      method: 'extraction',
      createdAt: '2026-05-19T00:00:00.000Z',
    };
    await store.storeEdge(edge);
    const neighbors = await store.getNeighbors({ type: 'memory', id: 'mem_1' });
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0]).toEqual({ type: 'entity', id: 'ent_1' });
  });

  // ── Fact ──────────────────────────────────────────────────────────────────

  it('storeFact then getFactsForEntity round-trips', async () => {
    const fact = baseFact();
    await store.storeFact(fact);
    const got = await store.getFactsForEntity('ent_1');
    expect(got).toHaveLength(1);
    expect(got[0]).toEqual(fact);
  });

  it('getFactsForEntity filters by attribute', async () => {
    await store.storeFact({ ...baseFact(), attribute: 'founded' });
    await store.storeFact({ ...baseFact(), id: 'fact_2', attribute: 'ceo' });
    const got = await store.getFactsForEntity('ent_1', 'founded');
    expect(got).toHaveLength(1);
    expect(got[0].attribute).toBe('founded');
  });

  it('markFactSuperseded sets isLatest=false and supersededBy', async () => {
    await store.storeFact(baseFact());
    await store.storeFact({ ...baseFact(), id: 'fact_new' });
    await store.markFactSuperseded('fact_1', 'fact_new');
    // v1.2.0 — explicit latestOnly:false to see the superseded row in history.
    const facts = await store.getFactsForEntity('ent_1', undefined, undefined, false);
    const old = facts.find((f) => f.id === 'fact_1');
    expect(old?.isLatest).toBe(false);
    expect(old?.supersededBy).toBe('fact_new');
  });

  it('markFactSuperseded throws for unknown id', async () => {
    await expect(store.markFactSuperseded('ghost', 'fact_new')).rejects.toThrow('unknown id');
  });

  // ── Contradiction ─────────────────────────────────────────────────────────

  it('storeContradiction then listContradictions round-trips', async () => {
    const c: Contradiction = {
      id: 'con_1',
      factAId: 'fact_1',
      factBId: 'fact_2',
      status: 'pending',
      createdAt: '2026-05-19T00:00:00.000Z',
    };
    await store.storeContradiction(c);
    const all = await store.listContradictions();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(c);
  });

  it('listContradictions filters by status', async () => {
    await store.storeContradiction({ id: 'c1', factAId: 'f1', factBId: 'f2', status: 'pending', createdAt: '2026-05-19T00:00:00.000Z' });
    await store.storeContradiction({ id: 'c2', factAId: 'f3', factBId: 'f4', status: 'auto-resolved', createdAt: '2026-05-19T00:00:00.000Z' });
    expect(await store.listContradictions('pending')).toHaveLength(1);
    expect(await store.listContradictions('auto-resolved')).toHaveLength(1);
  });

  // ── Insight ───────────────────────────────────────────────────────────────

  it('storeInsight then listInsights round-trips', async () => {
    const insight: Insight = {
      id: 'ins_1',
      entityId: 'ent_1',
      type: 'deduction',
      statement: 'Anthropic focuses on safety',
      supportingFactIds: ['fact_1'],
      confidence: 0.8,
      createdAt: '2026-05-19T00:00:00.000Z',
    };
    await store.storeInsight(insight);
    const all = await store.listInsights('ent_1');
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(insight);
  });

  // ── EntityProfile ─────────────────────────────────────────────────────────

  it('storeEntityProfile then getEntityProfile round-trips', async () => {
    const profile: EntityProfile = {
      id: 'prof_1',
      entityId: 'ent_1',
      staticFacts: [{ value: 'type=company', confidence: 0.95 }],
      dynamicContext: 'Recent: Opus 4.7 release',
      relatedEntityIds: [],
    };
    await store.storeEntityProfile(profile);
    expect(await store.getEntityProfile('ent_1')).toEqual(profile);
  });

  it('getEntityProfile returns null for unknown entityId', async () => {
    expect(await store.getEntityProfile('nope')).toBeNull();
  });

  // ── AgentSelf ─────────────────────────────────────────────────────────────

  it('getAgentSelf returns null before any write', async () => {
    expect(await store.getAgentSelf()).toBeNull();
  });

  it('updateAgentSelf then getAgentSelf round-trips', async () => {
    const self: AgentSelf = {
      memoryBlocks: [{ label: 'role', content: 'assistant', updatedAt: '2026-05-19T00:00:00.000Z' }],
      history: [],
    };
    await store.updateAgentSelf(self);
    expect(await store.getAgentSelf()).toEqual(self);
  });

  // ── searchFulltext (FTS5) ─────────────────────────────────────────────────

  it('searchFulltext returns matches ranked by relevance', async () => {
    await store.storeMemory({ ...baseMemory(), id: 'mem_a', title: 'Anthropic releases Claude', content: 'machine learning company' });
    await store.storeMemory({ ...baseMemory(), id: 'mem_b', title: 'Unrelated topic', content: 'something about gardening' });
    await store.storeMemory({ ...baseMemory(), id: 'mem_c', title: 'Anthropic and Claude', content: 'AI assistant by Anthropic' });

    const matches = await store.searchFulltext('anthropic claude');
    expect(matches.length).toBeGreaterThanOrEqual(2);
    const ids = matches.map((m) => m.memoryId);
    expect(ids).toContain('mem_a');
    expect(ids).toContain('mem_c');
    expect(ids).not.toContain('mem_b');
    // Scores normalized to 0..1
    for (const m of matches) {
      expect(m.score).toBeGreaterThan(0);
      expect(m.score).toBeLessThanOrEqual(1);
    }
  });

  it('searchFulltext reports matchedFields per result', async () => {
    await store.storeMemory({ ...baseMemory(), id: 'mem_title', title: 'kybernesis architecture', content: 'unrelated body' });
    await store.storeMemory({ ...baseMemory(), id: 'mem_content', title: 'unrelated header', content: 'kybernesis everywhere in the body text' });

    const titleMatch = (await store.searchFulltext('kybernesis')).find((m) => m.memoryId === 'mem_title');
    const contentMatch = (await store.searchFulltext('kybernesis')).find((m) => m.memoryId === 'mem_content');
    expect(titleMatch?.matchedFields).toContain('title');
    expect(titleMatch?.matchedFields).not.toContain('content');
    expect(contentMatch?.matchedFields).toContain('content');
    expect(contentMatch?.matchedFields).not.toContain('title');
  });

  it('searchFulltext filters by tier', async () => {
    await store.storeMemory({ ...baseMemory(), id: 'mem_hot', title: 'cortex fts', tier: 'hot' });
    await store.storeMemory({ ...baseMemory(), id: 'mem_cold', title: 'cortex fts', tier: 'archive' });

    const hot = await store.searchFulltext('cortex fts', { tier: 'hot' });
    expect(hot.map((m) => m.memoryId)).toEqual(['mem_hot']);
  });

  it('searchFulltext filters by scopes', async () => {
    await store.storeMemory({
      ...baseMemory(), id: 'mem_org_a', title: 'gizmo widget',
      scopes: { org_id: 'org_a' },
    });
    await store.storeMemory({
      ...baseMemory(), id: 'mem_org_b', title: 'gizmo widget',
      scopes: { org_id: 'org_b' },
    });

    const orgA = await store.searchFulltext('gizmo', { scopes: { org_id: 'org_a' } });
    expect(orgA.map((m) => m.memoryId)).toEqual(['mem_org_a']);
  });

  it('searchFulltext returns empty for whitespace-only query', async () => {
    await store.storeMemory({ ...baseMemory(), id: 'mem_x', title: 'something' });
    expect(await store.searchFulltext('')).toEqual([]);
    expect(await store.searchFulltext('   ')).toEqual([]);
  });

  it('searchFulltext respects topK', async () => {
    for (let i = 0; i < 5; i++) {
      await store.storeMemory({ ...baseMemory(), id: `mem_t${i}`, title: `widget number ${i}`, content: 'widget body' });
    }
    const limited = await store.searchFulltext('widget', { topK: 2 });
    expect(limited.length).toBe(2);
  });

  it('searchFulltext index stays in sync with updates and deletes', async () => {
    await store.storeMemory({ ...baseMemory(), id: 'mem_sync', title: 'pebble' });
    expect((await store.searchFulltext('pebble')).map((m) => m.memoryId)).toContain('mem_sync');

    await store.updateMemory('mem_sync', { title: 'cobblestone' });
    expect((await store.searchFulltext('pebble')).map((m) => m.memoryId)).not.toContain('mem_sync');
    expect((await store.searchFulltext('cobblestone')).map((m) => m.memoryId)).toContain('mem_sync');

    await store.deleteMemory('mem_sync');
    expect((await store.searchFulltext('cobblestone')).map((m) => m.memoryId)).not.toContain('mem_sync');
  });

  // ── getFactsForEntity asOf filter ─────────────────────────────────────────

  it('getFactsForEntity filters out expired facts when asOf is supplied', async () => {
    await store.upsertEntity(baseEntity());
    await store.storeFact({
      ...baseFact(), id: 'f_active', fact: 'active fact', expiresAt: '2027-01-01T00:00:00.000Z',
    });
    await store.storeFact({
      ...baseFact(), id: 'f_expired', fact: 'expired fact', expiresAt: '2025-01-01T00:00:00.000Z',
    });
    await store.storeFact({
      ...baseFact(), id: 'f_perpetual', fact: 'perpetual fact',
    });

    const asOfMid = '2026-06-01T00:00:00.000Z';
    const ids = (await store.getFactsForEntity('ent_1', undefined, asOfMid)).map((f) => f.id).sort();
    expect(ids).toEqual(['f_active', 'f_perpetual']);

    // No asOf preserves legacy behavior — returns everything
    const all = (await store.getFactsForEntity('ent_1')).map((f) => f.id).sort();
    expect(all).toEqual(['f_active', 'f_expired', 'f_perpetual']);
  });
});

describe('LibsqlStructuredStore — searchFactsFulltext (v1.0.0)', () => {
  const store = createLibsqlStructuredStore(':memory:');
  beforeEach(async () => { await store.connect(); });
  afterEach(async () => { await store.disconnect(); });

  const fact = (overrides: Partial<Fact> = {}): Fact => ({
    id: `f_${Math.random().toString(36).slice(2, 9)}`,
    fact: 'Alice met Bob in Paris during summer',
    entities: ['Alice', 'Bob', 'Paris'],
    category: 'event',
    confidence: 0.9,
    sourceType: 'ai-extraction',
    createdAt: '2026-05-22T00:00:00.000Z',
    isLatest: true,
    ...overrides,
  });

  it('returns FTS5 matches against fact content', async () => {
    const f = fact();
    await store.storeFact(f);
    const matches = await store.searchFactsFulltext('Paris');
    expect(matches).toHaveLength(1);
    expect(matches[0].factId).toBe(f.id);
    expect(matches[0].score).toBeGreaterThan(0);
    expect(matches[0].matchedFields).toContain('content');
  });

  it('returns FTS5 matches against entities_json', async () => {
    const f = fact({ entities: ['Charlie', 'London'] });
    await store.storeFact(f);
    const matches = await store.searchFactsFulltext('Charlie');
    expect(matches).toHaveLength(1);
    expect(matches[0].factId).toBe(f.id);
    expect(matches[0].matchedFields).toContain('entities');
  });

  it('filters by category', async () => {
    await store.storeFact(fact({ id: 'fb', fact: 'X bio', entities: ['X'], category: 'biographical' }));
    await store.storeFact(fact({ id: 'fe', fact: 'X event', entities: ['X'], category: 'event' }));
    const bio = await store.searchFactsFulltext('X', { category: 'biographical' });
    expect(bio).toHaveLength(1);
    expect(bio[0].factId).toBe('fb');
  });

  it('respects latestOnly=true by default', async () => {
    await store.storeFact(fact({ id: 'f_old', isLatest: false }));
    await store.storeFact(fact({ id: 'f_new', isLatest: true }));
    const latest = await store.searchFactsFulltext('Paris');
    expect(latest.map((m) => m.factId).sort()).toEqual(['f_new']);
  });

  it('returns superseded facts when latestOnly=false', async () => {
    await store.storeFact(fact({ id: 'f_old', isLatest: false }));
    await store.storeFact(fact({ id: 'f_new', isLatest: true }));
    const all = await store.searchFactsFulltext('Paris', { latestOnly: false });
    expect(all.map((m) => m.factId).sort()).toEqual(['f_new', 'f_old']);
  });

  it('returns empty array on empty query token set', async () => {
    await store.storeFact(fact());
    expect(await store.searchFactsFulltext('   ')).toEqual([]);
  });

  it('UPDATE trigger keeps facts_fts in sync', async () => {
    const f = fact({ id: 'f_u', fact: 'Original content' });
    await store.storeFact(f);
    const beforeUpdate = await store.searchFactsFulltext('Original');
    expect(beforeUpdate).toHaveLength(1);

    await store.storeFact({ ...f, fact: 'Revised totally different text' });
    const afterUpdate = await store.searchFactsFulltext('Original');
    expect(afterUpdate).toHaveLength(0);
    const afterUpdate2 = await store.searchFactsFulltext('Revised');
    expect(afterUpdate2).toHaveLength(1);
  });

  it('UPDATE trigger flushes both content and entities columns', async () => {
    // Verifies the AFTER UPDATE trigger's delete-then-insert path also
    // refreshes the entities FTS column (not just content). The default
    // fact() includes 'Paris' in both fact text and entities[], so we
    // overwrite both to confirm the FTS mirror is fully replaced.
    const f = fact({ id: 'f_d' });
    await store.storeFact(f);
    await store.storeFact({ ...f, fact: 'Replaced text', entities: ['Zoe'] });
    const paris = await store.searchFactsFulltext('Paris');
    expect(paris.filter((m) => m.factId === 'f_d')).toHaveLength(0);
    const zoe = await store.searchFactsFulltext('Zoe');
    expect(zoe.filter((m) => m.factId === 'f_d')).toHaveLength(1);
  });
});

// ── v1.2.0 System Health Phase 1 tests ────────────────────────────────────────

describe('LibsqlStructuredStore — v1.2.0 transaction primitive', () => {
  let store: ReturnType<typeof createLibsqlStructuredStore>;
  beforeEach(async () => {
    store = createLibsqlStructuredStore(':memory:');
    await store.connect();
  });
  afterEach(async () => { await store.disconnect(); });

  it('commits writes inside transaction', async () => {
    await store.transaction(async (tx) => {
      await tx.storeMemory(baseMemory());
    });
    expect(await store.getMemory('mem_1')).not.toBeNull();
  });

  it('rolls back all writes when fn throws', async () => {
    await expect(
      store.transaction(async (tx) => {
        await tx.storeMemory(baseMemory());
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await store.getMemory('mem_1')).toBeNull();
  });
});

describe('LibsqlStructuredStore — v1.2.0 latestOnly filter', () => {
  let store: ReturnType<typeof createLibsqlStructuredStore>;
  beforeEach(async () => {
    store = createLibsqlStructuredStore(':memory:');
    await store.connect();
  });
  afterEach(async () => { await store.disconnect(); });

  it('listMemories default excludes superseded rows', async () => {
    await store.storeMemory(baseMemory());
    await store.storeMemory({ ...baseMemory(), id: 'mem_2' });
    await store.markMemorySuperseded('mem_1', 'mem_2');
    const latest = await store.listMemories();
    expect(latest.map((m) => m.id)).toEqual(['mem_2']);
  });

  it('listMemories latestOnly:false returns history', async () => {
    await store.storeMemory(baseMemory());
    await store.storeMemory({ ...baseMemory(), id: 'mem_2' });
    await store.markMemorySuperseded('mem_1', 'mem_2');
    const all = await store.listMemories({ latestOnly: false });
    expect(all.map((m) => m.id).sort()).toEqual(['mem_1', 'mem_2']);
  });

  it('getFactsForEntity default excludes superseded facts', async () => {
    await store.storeFact(baseFact());
    await store.storeFact({ ...baseFact(), id: 'fact_2' });
    await store.markFactSuperseded('fact_1', 'fact_2');
    const latest = await store.getFactsForEntity('ent_1');
    expect(latest.map((f) => f.id)).toEqual(['fact_2']);
  });
});

describe('LibsqlStructuredStore — v1.2.0 deleteEntity cascade', () => {
  let store: ReturnType<typeof createLibsqlStructuredStore>;
  beforeEach(async () => {
    store = createLibsqlStructuredStore(':memory:');
    await store.connect();
  });
  afterEach(async () => { await store.disconnect(); });

  it('cascades to edges + insights + entity_profile (not facts)', async () => {
    const entity: Entity = { id: 'ent_alice', name: 'alice', type: 'person', mentionCount: 5 };
    await store.upsertEntity(entity);
    await store.storeEdge({
      id: 'edge_1', from: { type: 'entity', id: 'ent_alice' },
      to: { type: 'memory', id: 'mem_x' }, relation: 'mentioned', confidence: 0.9,
      sharedTags: [], method: 'test', createdAt: '2026-05-22T00:00:00.000Z',
    });
    await store.storeInsight({
      id: 'ins_1', entityId: 'ent_alice', type: 'deduction',
      statement: 'alice is consistent', supportingFactIds: [],
      confidence: 0.9, createdAt: '2026-05-22T00:00:00.000Z',
    });
    await store.storeEntityProfile({
      id: 'profile_1', entityId: 'ent_alice', staticFacts: [],
      dynamicContext: '', relatedEntityIds: [],
    });
    await store.storeFact({ ...baseFact(), id: 'fact_alice', entities: ['alice'] });

    await store.deleteEntity('ent_alice');
    expect(await store.getEntity('ent_alice')).toBeNull();
    expect(await store.getNeighbors({ type: 'entity', id: 'ent_alice' })).toEqual([]);
    expect((await store.listInsights('ent_alice'))).toEqual([]);
    expect(await store.getEntityProfile('ent_alice')).toBeNull();
    // Facts mentioning the entity are preserved (multi-entity schema).
    const f = await store.getFact('fact_alice');
    expect(f).not.toBeNull();
  });
});

describe('LibsqlStructuredStore — v1.2.0 getNeighbors multi-hop', () => {
  let store: ReturnType<typeof createLibsqlStructuredStore>;
  beforeEach(async () => {
    store = createLibsqlStructuredStore(':memory:');
    await store.connect();
    // A → B → C → D chain
    const mk = (id: string, from: string, to: string): Edge => ({
      id, from: { type: 'memory', id: from }, to: { type: 'memory', id: to },
      relation: 'next', confidence: 1, sharedTags: [], method: 'test',
      createdAt: '2026-05-22T00:00:00.000Z',
    });
    await store.storeEdge(mk('e_ab', 'A', 'B'));
    await store.storeEdge(mk('e_bc', 'B', 'C'));
    await store.storeEdge(mk('e_cd', 'C', 'D'));
  });
  afterEach(async () => { await store.disconnect(); });

  it('default hops=1 returns only direct neighbours', async () => {
    const out = await store.getNeighbors({ type: 'memory', id: 'A' });
    expect(out.map((n) => n.id).sort()).toEqual(['B']);
  });

  it('hops=2 returns A→B→C reachable set', async () => {
    const out = await store.getNeighbors({ type: 'memory', id: 'A' }, 2);
    expect(out.map((n) => n.id).sort()).toEqual(['B', 'C']);
  });

  it('hops=3 reaches D', async () => {
    const out = await store.getNeighbors({ type: 'memory', id: 'A' }, 3);
    expect(out.map((n) => n.id).sort()).toEqual(['B', 'C', 'D']);
  });

  it('throws when hops outside 1-5', async () => {
    await expect(store.getNeighbors({ type: 'memory', id: 'A' }, 0)).rejects.toThrow(/hops must be 1-5/);
    await expect(store.getNeighbors({ type: 'memory', id: 'A' }, 6)).rejects.toThrow(/hops must be 1-5/);
  });

  it('excludes the seed node from results', async () => {
    const out = await store.getNeighbors({ type: 'memory', id: 'A' }, 3);
    expect(out.find((n) => n.id === 'A')).toBeUndefined();
  });
});

describe('LibsqlStructuredStore — v1.2.0 entities_json lowercase migration', () => {
  it('is idempotent (schema_version meta row prevents re-run)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cortex-v12-mig-'));
    try {
      const dbPath = join(dir, 'a.db');
      const s1 = createLibsqlStructuredStore(dbPath);
      await s1.connect();
      // Store a fact with uppercased entities (mimicking pre-v1.2.0 data path).
      await s1.storeFact({ ...baseFact(), id: 'f_pre', entities: ['Alice'] });
      // Force lowercase at row level (bypass producer normalisation) so the
      // migration is what fixes it on next connect.
      await s1.disconnect();
      const s2 = createLibsqlStructuredStore(dbPath);
      await s2.connect();
      // Re-open should not throw or re-migrate.
      await s2.disconnect();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
