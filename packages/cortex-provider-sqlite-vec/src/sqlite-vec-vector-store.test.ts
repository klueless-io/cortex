import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSqliteVecVectorStore } from './sqlite-vec-vector-store.js';

// Use 3-dimensional vectors for fast tests
const DIMS = 3;

const makeStore = () => createSqliteVecVectorStore(':memory:', { dimensions: DIMS });

// Simple 3D test vectors
const vec = (x: number, y: number, z: number) => [x, y, z];

describe('SqliteVecVectorStore (in-memory)', () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(async () => {
    store = makeStore();
    await store.connect();
  });

  afterEach(async () => {
    await store.disconnect();
  });

  // ── lifecycle ─────────────────────────────────────────────────────────────

  it('connect + disconnect do not throw', async () => {
    // beforeEach/afterEach cover this; just assert we got here
    expect(true).toBe(true);
  });

  it('throws when not connected', async () => {
    const cold = makeStore();
    await expect(cold.query(vec(1, 0, 0))).rejects.toThrow('not connected');
  });

  it('connect() creates missing parent directories for file-based paths', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cortex-vec-test-'));
    const dbPath = join(base, 'nested', 'deep', 'cortex-vec.db');
    const fileStore = createSqliteVecVectorStore(dbPath, { dimensions: DIMS });
    await expect(fileStore.connect()).resolves.not.toThrow();
    await fileStore.disconnect();
    rmSync(base, { recursive: true, force: true });
  });

  // ── query on empty store ──────────────────────────────────────────────────

  it('query on empty store returns empty array', async () => {
    const results = await store.query(vec(1, 0, 0));
    expect(results).toEqual([]);
  });

  // ── upsert + query ────────────────────────────────────────────────────────

  it('upsert then query returns the inserted item', async () => {
    await store.upsert([{ id: 'a', vector: vec(1, 0, 0), metadata: { label: 'A' } }]);
    const results = await store.query(vec(1, 0, 0), { topK: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('a');
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].metadata).toEqual({ label: 'A' });
  });

  it('query returns items sorted by similarity score descending', async () => {
    // Insert three vectors: 'near' is closest to query, 'far' is furthest
    await store.upsert([
      { id: 'near', vector: vec(1, 0, 0) },
      { id: 'mid',  vector: vec(0.5, 0.5, 0) },
      { id: 'far',  vector: vec(0, 0, 1) },
    ]);

    const results = await store.query(vec(1, 0, 0), { topK: 3 });
    expect(results).toHaveLength(3);

    // Scores should be descending (higher = more similar)
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }

    // The closest vector should come first
    expect(results[0].id).toBe('near');
  });

  it('query respects topK limit', async () => {
    await store.upsert([
      { id: 'a', vector: vec(1, 0, 0) },
      { id: 'b', vector: vec(0, 1, 0) },
      { id: 'c', vector: vec(0, 0, 1) },
    ]);

    const results = await store.query(vec(1, 0, 0), { topK: 2 });
    expect(results).toHaveLength(2);
  });

  // ── delete ────────────────────────────────────────────────────────────────

  it('delete removes items from results', async () => {
    await store.upsert([
      { id: 'keep', vector: vec(1, 0, 0) },
      { id: 'drop', vector: vec(1, 0, 0) },
    ]);

    await store.delete(['drop']);

    const results = await store.query(vec(1, 0, 0), { topK: 10 });
    const ids = results.map((r) => r.id);
    expect(ids).not.toContain('drop');
    expect(ids).toContain('keep');
  });

  it('delete with empty ids array is a no-op', async () => {
    await store.upsert([{ id: 'a', vector: vec(1, 0, 0) }]);
    await expect(store.delete([])).resolves.not.toThrow();
    const results = await store.query(vec(1, 0, 0), { topK: 10 });
    expect(results).toHaveLength(1);
  });

  // ── upsert idempotency ────────────────────────────────────────────────────

  it('upsert with same id replaces the existing vector', async () => {
    await store.upsert([{ id: 'a', vector: vec(1, 0, 0), metadata: { v: 1 } }]);
    await store.upsert([{ id: 'a', vector: vec(0, 1, 0), metadata: { v: 2 } }]);

    const results = await store.query(vec(0, 1, 0), { topK: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('a');
    expect(results[0].metadata).toEqual({ v: 2 });
  });

  // ── metadata ──────────────────────────────────────────────────────────────

  it('upsert without metadata defaults to empty object', async () => {
    await store.upsert([{ id: 'no-meta', vector: vec(1, 0, 0) }]);
    const results = await store.query(vec(1, 0, 0), { topK: 1 });
    expect(results[0].metadata).toEqual({});
  });
});
