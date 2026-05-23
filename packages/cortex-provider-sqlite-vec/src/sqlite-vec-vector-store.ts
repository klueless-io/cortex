import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  VectorStore,
  VectorItem,
  VectorQueryOpts,
  VectorMatch,
} from '@kybernesis/cortex-contracts';
import { makeDDL } from './schema.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function toFloat32Buffer(vector: number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

function assertConnected(
  db: Database.Database | null,
): asserts db is Database.Database {
  if (!db) {
    throw new Error(
      'SqliteVecVectorStore: not connected — call connect() first',
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// ─── factory ─────────────────────────────────────────────────────────────────

export function createSqliteVecVectorStore(
  dbPath: string,
  opts: { dimensions?: number } = {},
): VectorStore {
  const dimensions = opts.dimensions ?? 1536;
  let db: Database.Database | null = null;

  return {
    // ── lifecycle ─────────────────────────────────────────────────────────

    connect: async () => {
      if (dbPath !== ':memory:') {
        mkdirSync(dirname(dbPath), { recursive: true });
      }
      db = new Database(dbPath);
      sqliteVec.load(db);
      db.exec(makeDDL(dimensions));
    },

    disconnect: async () => {
      db?.close();
      db = null;
    },

    // ── upsert ────────────────────────────────────────────────────────────

    upsert: async (items: VectorItem[]) => {
      assertConnected(db);

      // vec_embeddings only accepts plain integer rowids; we store the
      // auto-assigned rowid in vec_metadata.rowid_ref so we can join and
      // delete without re-scanning the virtual table.
      //
      // Upsert strategy per item:
      //   1. If the id already exists in vec_metadata → delete the old vec row
      //      so we can insert a fresh one (vec0 doesn't support UPDATE).
      //   2. Insert the new embedding (auto rowid assigned by vec0).
      //   3. Get that new rowid via last_insert_rowid().
      //   4. INSERT OR REPLACE vec_metadata with the new rowid_ref.

      const getExisting = db.prepare(
        'SELECT rowid_ref FROM vec_metadata WHERE id = ?',
      );
      const deleteVec = db.prepare(
        'DELETE FROM vec_embeddings WHERE rowid = ?',
      );
      const insertVec = db.prepare(
        'INSERT INTO vec_embeddings (embedding) VALUES (vec_f32(?))',
      );
      const lastRowid = db.prepare('SELECT last_insert_rowid() AS id');
      const upsertMeta = db.prepare(
        'INSERT OR REPLACE INTO vec_metadata (id, rowid_ref, metadata) VALUES (?, ?, ?)',
      );

      const upsertAll = db.transaction((upsertItems: VectorItem[]) => {
        for (const item of upsertItems) {
          // Delete the old vec row if this id already exists
          const existing = getExisting.get(item.id) as Row | undefined;
          if (existing) {
            deleteVec.run(existing.rowid_ref as number);
          }

          // Insert new embedding (vec0 assigns its own integer rowid)
          insertVec.run(toFloat32Buffer(item.vector));
          const vecRowid = (lastRowid.get() as Row).id as number;

          // Store string id → vec rowid mapping
          upsertMeta.run(item.id, vecRowid, JSON.stringify(item.metadata ?? {}));
        }
      });

      upsertAll(items);
    },

    // ── query ─────────────────────────────────────────────────────────────

    query: async (vector: number[], opts?: VectorQueryOpts) => {
      assertConnected(db);
      const topK = opts?.topK ?? 10;

      // vec0 KNN search requires either `k = ?` in the WHERE clause or a
      // LIMIT — using `k = ?` is the canonical form.
      const rows = db.prepare(`
        SELECT m.id, m.metadata, v.distance
        FROM vec_embeddings v
        JOIN vec_metadata m ON m.rowid_ref = v.rowid
        WHERE v.embedding MATCH vec_f32(?) AND k = ?
        ORDER BY v.distance
      `).all(toFloat32Buffer(vector), topK) as Row[];

      return rows.map((row) => ({
        id: row.id as string,
        score: 1 / (1 + (row.distance as number)),
        metadata: JSON.parse(row.metadata as string) as Record<string, unknown>,
      })) satisfies VectorMatch[];
    },

    // ── delete ────────────────────────────────────────────────────────────

    delete: async (ids: string[]) => {
      assertConnected(db);
      if (ids.length === 0) return;

      const placeholders = ids.map(() => '?').join(', ');

      const deleteAll = db.transaction((deleteIds: string[]) => {
        // Delete vec rows by their stored rowid references
        db!.prepare(`
          DELETE FROM vec_embeddings
          WHERE rowid IN (
            SELECT rowid_ref FROM vec_metadata WHERE id IN (${placeholders})
          )
        `).run(...deleteIds);

        // Then remove the metadata rows
        db!.prepare(`
          DELETE FROM vec_metadata WHERE id IN (${placeholders})
        `).run(...deleteIds);
      });

      deleteAll(ids);
    },
  };
}
