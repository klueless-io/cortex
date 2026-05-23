import Database from 'libsql';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  StructuredStore,
  Memory,
  Chunk,
  Entity,
  Edge,
  Fact,
  Contradiction,
  Insight,
  EntityProfile,
  AgentSelf,
  NodeRef,
  MemoryFilter,
  EntityFilter,
  FulltextSearchOpts,
  FulltextMatch,
  FulltextField,
  FactsFulltextSearchOpts,
  FactsFulltextMatch,
  FactsFulltextField,
} from '@kybernesis/cortex-contracts';
import { DDL } from './schema.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function j(v: unknown): string {
  return JSON.stringify(v);
}

function p<T>(v: string | null | undefined): T {
  return JSON.parse(v ?? 'null') as T;
}

function bool(v: number | null | undefined): boolean {
  return v === 1;
}

function int(v: boolean): number {
  return v ? 1 : 0;
}

function assertConnected(
  db: Database.Database | null,
): asserts db is Database.Database {
  if (!db) {
    throw new Error(
      'LibsqlStructuredStore: not connected — call connect() first',
    );
  }
}

// ─── fulltext helpers ────────────────────────────────────────────────────────

const FTS_FIELDS: readonly FulltextField[] = ['title', 'summary', 'content', 'tags'] as const;
const FACTS_FTS_FIELDS: readonly FactsFulltextField[] = ['content', 'entities'] as const;

/** Escape backslash, percent, underscore for SQL LIKE with ESCAPE '\\'. */
function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Maximum input length accepted by `buildFtsQuery`. Anything longer is
 * rejected (returns null) to bound memory + tokenizer cost. 10 KB covers
 * any plausible natural-language query.
 */
const MAX_FTS_QUERY_LENGTH = 10_000;

/**
 * Build an FTS5 MATCH query from a natural-language string. Words are
 * lowercased, double-quote-escaped, and OR'd together. Returns null when
 * the input has no usable tokens OR exceeds MAX_FTS_QUERY_LENGTH.
 */
function buildFtsQuery(query: string): { ftsQuery: string; tokens: string[] } | null {
  if (query.length > MAX_FTS_QUERY_LENGTH) return null;
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 0);
  if (tokens.length === 0) return null;
  const ftsQuery = tokens.map((w) => `"${w.replace(/"/g, '""')}"`).join(' OR ');
  return { ftsQuery, tokens };
}

/**
 * FTS5 `rank` is a real number; lower (more negative) = better match.
 * Normalize to 0..1 where higher = better, monotonic in |rank|.
 */
function normalizeRank(rank: number): number {
  return 1 / (1 + Math.abs(rank));
}

/**
 * Cheaply detect which fields contain at least one query token. Avoids
 * an extra per-column FTS query.
 */
function detectMatchedFields(
  row: Row,
  tokens: string[],
  selected: readonly FulltextField[],
): FulltextField[] {
  const matched: FulltextField[] = [];
  for (const field of selected) {
    const haystack = String(row[field] ?? '').toLowerCase();
    if (tokens.some((t) => haystack.includes(t))) matched.push(field);
  }
  return matched;
}

// ─── row mappers ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function rowToMemory(row: Row): Memory {
  return {
    id: row.id as string,
    title: row.title as string,
    summary: row.summary as string,
    content: row.content as string,
    tags: p<string[]>(row.tags as string),
    priority: row.priority as number,
    tier: row.tier as Memory['tier'],
    decayScore: row.decay_score as number,
    accessCount: row.access_count as number,
    createdAt: row.created_at as string,
    lastAccessedAt: (row.last_accessed_at as string | null) ?? undefined,
    isPinned: bool(row.is_pinned as number),
    contentHash: row.content_hash as string,
    source: row.source as Memory['source'],
    status: row.status as Memory['status'],
    isLatest: bool(row.is_latest as number),
    supersededBy: (row.superseded_by as string | null) ?? undefined,
    scopes: row.scopes ? p(row.scopes as string) : undefined,
  };
}

function memoryToRow(m: Memory): Row {
  return {
    id: m.id,
    title: m.title,
    summary: m.summary,
    content: m.content,
    tags: j(m.tags),
    priority: m.priority,
    tier: m.tier,
    decay_score: m.decayScore,
    access_count: m.accessCount,
    created_at: m.createdAt,
    last_accessed_at: m.lastAccessedAt ?? null,
    is_pinned: int(m.isPinned),
    content_hash: m.contentHash,
    source: m.source,
    status: m.status,
    is_latest: int(m.isLatest),
    superseded_by: m.supersededBy ?? null,
    scopes: m.scopes ? j(m.scopes) : null,
  };
}

function rowToChunk(row: Row): Chunk {
  return {
    id: row.id as string,
    memoryId: row.memory_id as string,
    text: row.text as string,
    vectorId: (row.vector_id as string | null) ?? undefined,
    layer: row.layer as Chunk['layer'],
  };
}

function rowToEntity(row: Row): Entity {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as Entity['type'],
    mentionCount: row.mention_count as number,
    scopes: row.scopes ? p(row.scopes as string) : undefined,
  };
}


function rowToFact(row: Row): Fact {
  const entitiesJson = row.entities_json as string | null;
  const entities: string[] = entitiesJson ? p<string[]>(entitiesJson) : [];
  return {
    id: row.id as string,
    fact: row.fact as string,
    entities,
    attribute: (row.attribute as string | null) ?? undefined,
    value: (row.value as string | null) ?? undefined,
    confidence: row.confidence as number,
    sourceType: row.source_type as Fact['sourceType'],
    sourceMemoryId: (row.source_memory_id as string | null) ?? undefined,
    sourcePath: (row.source_path as string | null) ?? undefined,
    sourceConversationId: (row.source_conversation_id as string | null) ?? undefined,
    category: (row.category as Fact['category']) ?? 'general',
    createdAt: row.created_at as string,
    lastReinforcedAt: (row.last_reinforced_at as string | null) ?? undefined,
    expiresAt: (row.expires_at as string | null) ?? undefined,
    isLatest: bool(row.is_latest as number),
    supersededBy: (row.superseded_by as string | null) ?? undefined,
    surprisalScore: (row.surprisal_score as number | null) ?? undefined,
    scopes: row.scopes ? p(row.scopes as string) : undefined,
  };
}

function rowToContradiction(row: Row): Contradiction {
  return {
    id: row.id as string,
    factAId: row.fact_a_id as string,
    factBId: row.fact_b_id as string,
    status: row.status as Contradiction['status'],
    rationale: (row.rationale as string | null) ?? undefined,
    resolution: (row.resolution as string | null) ?? undefined,
    createdAt: row.created_at as string,
  };
}

function rowToInsight(row: Row): Insight {
  return {
    id: row.id as string,
    entityId: (row.entity_id as string | null) ?? undefined,
    type: row.type as Insight['type'],
    statement: row.statement as string,
    supportingFactIds: p<string[]>(row.supporting_fact_ids as string),
    confidence: row.confidence as number,
    createdAt: row.created_at as string,
  };
}

function rowToEntityProfile(row: Row): EntityProfile {
  return {
    id: row.id as string,
    entityId: row.entity_id as string,
    staticFacts: p(row.static_facts as string),
    dynamicContext: row.dynamic_context as string,
    narrativeProse: (row.narrative_prose as string | null) ?? undefined,
    relatedEntityIds: p<string[]>(row.related_entity_ids as string),
  };
}

// ─── factory ─────────────────────────────────────────────────────────────────

export function createLibsqlStructuredStore(dbPath: string): StructuredStore {
  let db: Database.Database | null = null;

  const store: StructuredStore = {
    // ── lifecycle ─────────────────────────────────────────────────────────

    connect: async () => {
      if (dbPath !== ':memory:') {
        mkdirSync(dirname(dbPath), { recursive: true });
      }
      db = new Database(dbPath);
      db.exec(DDL);

      // Idempotent migration: add created_at to memories if a v0.3.x database
      // is being opened. PRAGMA table_info returns 0 rows on a freshly-created
      // table only momentarily; after exec(DDL), the column already exists for
      // new databases. The check is cheap and avoids throwing on duplicate-add.
      const cols = db.prepare("PRAGMA table_info(memories)").all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'created_at')) {
        db.exec(
          `ALTER TABLE memories ADD COLUMN created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        );
      }

      // v1.2.0 — meta table + idempotent entity-normalisation migration.
      // schema_version 2 = facts.entities_json values are stored lowercased.
      db.exec(
        `CREATE TABLE IF NOT EXISTS _cortex_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      );
      const versionRow = db
        .prepare("SELECT value FROM _cortex_meta WHERE key = 'schema_version'")
        .get() as { value: string } | undefined;
      const schemaVersion = versionRow ? Number(versionRow.value) : 1;
      if (schemaVersion < 2) {
        // LOWER on the JSON text lowercases the entity-name string values.
        // JSON syntax tokens (brackets, commas, quotes) are all ASCII-stable
        // under LOWER. The AFTER UPDATE trigger keeps facts_fts in sync.
        db.exec(`UPDATE facts SET entities_json = LOWER(entities_json)`);
        db.prepare(
          "INSERT OR REPLACE INTO _cortex_meta (key, value) VALUES ('schema_version', '2')",
        ).run();
      }
    },

    disconnect: async () => {
      db?.close();
      db = null;
    },

    // ── Memory ────────────────────────────────────────────────────────────

    storeMemory: async (memory: Memory) => {
      assertConnected(db);
      const row = memoryToRow(memory);
      db.prepare(`
        INSERT OR REPLACE INTO memories
          (id, title, summary, content, tags, priority, tier, decay_score,
           access_count, created_at, last_accessed_at, is_pinned, content_hash, source,
           status, is_latest, superseded_by, scopes)
        VALUES
          (@id, @title, @summary, @content, @tags, @priority, @tier, @decay_score,
           @access_count, @created_at, @last_accessed_at, @is_pinned, @content_hash, @source,
           @status, @is_latest, @superseded_by, @scopes)
      `).run(row);
    },

    getMemory: async (id: string) => {
      assertConnected(db);
      const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Row | undefined;
      return row ? rowToMemory(row) : null;
    },

    listMemories: async (filter?: MemoryFilter) => {
      assertConnected(db);
      let sql = 'SELECT * FROM memories WHERE 1=1';
      const params: unknown[] = [];
      // v1.2.0 — default latestOnly=true; only superseded callers opt out.
      if (filter?.latestOnly !== false) {
        sql += ' AND is_latest = 1';
      }
      if (filter?.tier) { sql += ' AND tier = ?'; params.push(filter.tier); }
      if (filter?.isPinned !== undefined) { sql += ' AND is_pinned = ?'; params.push(int(filter.isPinned)); }
      if (filter?.limit !== undefined) { sql += ' LIMIT ?'; params.push(filter.limit); }
      const rows = db.prepare(sql).all(...params) as Row[];
      let results = rows.map(rowToMemory);
      if (filter?.scopes) {
        const wanted = filter.scopes;
        results = results.filter((m) => {
          const ms = m.scopes ?? {};
          if (wanted.org_id !== undefined && ms.org_id !== wanted.org_id) return false;
          if (wanted.project_id !== undefined && ms.project_id !== wanted.project_id) return false;
          return true;
        });
      }
      return results;
    },

    updateMemory: async (id: string, fields: Partial<Omit<Memory, 'id'>>) => {
      assertConnected(db);
      const existing = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Row | undefined;
      if (!existing) throw new Error(`LibsqlStructuredStore: updateMemory — unknown id ${id}`);
      const merged = { ...rowToMemory(existing), ...fields };
      const row = memoryToRow(merged);
      db.prepare(`
        UPDATE memories SET
          title=@title, summary=@summary, content=@content, tags=@tags,
          priority=@priority, tier=@tier, decay_score=@decay_score,
          access_count=@access_count, created_at=@created_at,
          last_accessed_at=@last_accessed_at,
          is_pinned=@is_pinned, content_hash=@content_hash, source=@source,
          status=@status, is_latest=@is_latest, superseded_by=@superseded_by, scopes=@scopes
        WHERE id=@id
      `).run(row);
    },

    markMemorySuperseded: async (oldMemoryId: string, newMemoryId: string) => {
      assertConnected(db);
      const info = db.prepare(
        'UPDATE memories SET is_latest=0, superseded_by=? WHERE id=?',
      ).run(newMemoryId, oldMemoryId);
      if ((info as { changes: number }).changes === 0) {
        throw new Error(`LibsqlStructuredStore: markMemorySuperseded — unknown id ${oldMemoryId}`);
      }
    },

    deleteMemory: async (id: string) => {
      assertConnected(db);
      db.prepare('DELETE FROM memories WHERE id=?').run(id);
      db.prepare('DELETE FROM chunks WHERE memory_id=?').run(id);
    },

    // ── Chunk ─────────────────────────────────────────────────────────────

    storeChunks: async (chunks: Chunk[]) => {
      assertConnected(db);
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO chunks (id, memory_id, text, vector_id, layer)
        VALUES (@id, @memory_id, @text, @vector_id, @layer)
      `);
      for (const chunk of chunks) {
        stmt.run({
          id: chunk.id,
          memory_id: chunk.memoryId,
          text: chunk.text,
          vector_id: chunk.vectorId ?? null,
          layer: chunk.layer,
        });
      }
    },

    getChunksForMemory: async (memoryId: string) => {
      assertConnected(db);
      const rows = db.prepare('SELECT * FROM chunks WHERE memory_id=?').all(memoryId) as Row[];
      return rows.map(rowToChunk);
    },

    // ── Entity ────────────────────────────────────────────────────────────

    upsertEntity: async (entity: Entity) => {
      assertConnected(db);
      db.prepare(`
        INSERT OR REPLACE INTO entities (id, name, type, mention_count, scopes)
        VALUES (@id, @name, @type, @mention_count, @scopes)
      `).run({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        mention_count: entity.mentionCount,
        scopes: entity.scopes ? j(entity.scopes) : null,
      });
    },

    getEntity: async (id: string) => {
      assertConnected(db);
      const row = db.prepare('SELECT * FROM entities WHERE id=?').get(id) as Row | undefined;
      return row ? rowToEntity(row) : null;
    },

    listEntities: async (filter?: EntityFilter) => {
      assertConnected(db);
      let sql = 'SELECT * FROM entities WHERE 1=1';
      const params: unknown[] = [];
      if (filter?.nameContains) {
        sql += ' AND LOWER(name) LIKE ?';
        params.push(`%${filter.nameContains.toLowerCase()}%`);
      }
      if (filter?.limit !== undefined) {
        sql += ' LIMIT ?';
        params.push(filter.limit);
      }
      const rows = db.prepare(sql).all(...params) as Row[];
      let results = rows.map(rowToEntity);
      if (filter?.scopes) {
        const wanted = filter.scopes;
        results = results.filter((e) => {
          const es = e.scopes ?? {};
          if (wanted.org_id !== undefined && es.org_id !== wanted.org_id) return false;
          if (wanted.project_id !== undefined && es.project_id !== wanted.project_id) return false;
          return true;
        });
      }
      return results;
    },

    deleteEntity: async (id: string) => {
      assertConnected(db);
      // v1.2.0 — cascade edges + insights + entity_profiles, then the entity
      // row itself. Facts mentioning this entity are preserved per the
      // multi-entity schema (v1.0.0 Fact.entities is a list — deleting one
      // entity must not invalidate facts that also reference others).
      db!.exec('BEGIN');
      try {
        db!.prepare(
          "DELETE FROM edges WHERE (from_type='entity' AND from_id=?) OR (to_type='entity' AND to_id=?)",
        ).run(id, id);
        db!.prepare('DELETE FROM insights WHERE entity_id=?').run(id);
        db!.prepare('DELETE FROM entity_profiles WHERE entity_id=?').run(id);
        db!.prepare('DELETE FROM entities WHERE id=?').run(id);
        db!.exec('COMMIT');
      } catch (err) {
        try { db!.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw err;
      }
    },

    // ── Edge ──────────────────────────────────────────────────────────────

    storeEdge: async (edge: Edge) => {
      assertConnected(db);
      db.prepare(`
        INSERT OR REPLACE INTO edges
          (id, from_type, from_id, to_type, to_id, relation, confidence,
           shared_tags, rationale, method, created_at, last_verified_at)
        VALUES
          (@id, @from_type, @from_id, @to_type, @to_id, @relation, @confidence,
           @shared_tags, @rationale, @method, @created_at, @last_verified_at)
      `).run({
        id: edge.id,
        from_type: edge.from.type,
        from_id: edge.from.id,
        to_type: edge.to.type,
        to_id: edge.to.id,
        relation: edge.relation,
        confidence: edge.confidence,
        shared_tags: j(edge.sharedTags),
        rationale: edge.rationale ?? null,
        method: edge.method,
        created_at: edge.createdAt,
        last_verified_at: edge.lastVerifiedAt ?? null,
      });
    },

    getNeighbors: async (node: NodeRef, hops?: number) => {
      assertConnected(db);
      const h = hops ?? 1;
      if (h < 1 || h > 5) {
        throw new Error(
          `LibsqlStructuredStore: getNeighbors hops must be 1-5 (got ${h})`,
        );
      }
      // v1.2.0 — recursive CTE for multi-hop neighbour traversal.
      // Edges are undirected for this purpose, so we union both directions
      // into a `bidir` synthetic relation, then BFS from the seed.
      // UNION (not UNION ALL) auto-dedupes to prevent cycles.
      const rows = db.prepare(`
        WITH RECURSIVE
          bidir(a_type, a_id, b_type, b_id) AS (
            SELECT from_type, from_id, to_type, to_id FROM edges
            UNION ALL
            SELECT to_type, to_id, from_type, from_id FROM edges
          ),
          reach(type, id, depth) AS (
            SELECT b_type, b_id, 1 FROM bidir
             WHERE a_type = ? AND a_id = ?
            UNION
            SELECT b.b_type, b.b_id, r.depth + 1
              FROM bidir b
              JOIN reach r ON b.a_type = r.type AND b.a_id = r.id
             WHERE r.depth < ?
          )
        SELECT DISTINCT type, id FROM reach
         WHERE NOT (type = ? AND id = ?)
      `).all(node.type, node.id, h, node.type, node.id) as Array<{ type: string; id: string }>;
      return rows.map((r) => ({ type: r.type as NodeRef['type'], id: r.id }));
    },

    // ── Fact ──────────────────────────────────────────────────────────────

    storeFact: async (fact: Fact) => {
      assertConnected(db);
      // INSERT OR REPLACE is supposed to fire AFTER DELETE + AFTER INSERT
      // triggers, but libsql's FTS5 virtual table doesn't always clear the
      // old shadow rows in that path. Pre-delete the FTS row explicitly so
      // the AFTER INSERT trigger always produces a clean state.
      db.prepare('DELETE FROM facts_fts WHERE fact_id = ?').run(fact.id);
      db.prepare(`
        INSERT OR REPLACE INTO facts
          (id, fact, entities_json, attribute, value, confidence, source_type,
           source_memory_id, source_path, source_conversation_id, category,
           created_at, last_reinforced_at, expires_at, is_latest, superseded_by,
           surprisal_score, scopes)
        VALUES
          (@id, @fact, @entities_json, @attribute, @value, @confidence, @source_type,
           @source_memory_id, @source_path, @source_conversation_id, @category,
           @created_at, @last_reinforced_at, @expires_at, @is_latest, @superseded_by,
           @surprisal_score, @scopes)
      `).run({
        id: fact.id,
        fact: fact.fact,
        entities_json: j(fact.entities),
        attribute: fact.attribute ?? null,
        value: fact.value ?? null,
        confidence: fact.confidence,
        source_type: fact.sourceType,
        source_memory_id: fact.sourceMemoryId ?? null,
        source_path: fact.sourcePath ?? null,
        source_conversation_id: fact.sourceConversationId ?? null,
        category: fact.category,
        created_at: fact.createdAt,
        last_reinforced_at: fact.lastReinforcedAt ?? null,
        expires_at: fact.expiresAt ?? null,
        is_latest: int(fact.isLatest),
        superseded_by: fact.supersededBy ?? null,
        surprisal_score: fact.surprisalScore ?? null,
        scopes: fact.scopes ? j(fact.scopes) : null,
      });
    },

    getFact: async (id: string) => {
      assertConnected(db);
      const row = db.prepare('SELECT * FROM facts WHERE id=?').get(id) as Row | undefined;
      return row ? rowToFact(row) : null;
    },

    getFactsForEntity: async (
      entity: string,
      attribute?: string,
      asOf?: string,
      latestOnly?: boolean,
    ) => {
      assertConnected(db);
      // v1.2.0: entities_json is stored lowercased (migration on connect).
      // Match exact (after the JSON-LIKE prefilter); no more case-coercion
      // needed since storage is canonical.
      const needle = entity.trim().toLowerCase();
      let sql = "SELECT * FROM facts WHERE LOWER(entities_json) LIKE ? ESCAPE '\\'";
      const params: unknown[] = [`%${escapeLike(needle)}%`];
      if (attribute !== undefined) {
        sql += ' AND attribute=?';
        params.push(attribute);
      }
      if (asOf !== undefined) {
        sql += ' AND (expires_at IS NULL OR expires_at > ?)';
        params.push(asOf);
      }
      // v1.2.0 — default latestOnly=true.
      if (latestOnly !== false) {
        sql += ' AND is_latest = 1';
      }
      const rows = db.prepare(sql).all(...params) as Row[];
      // Post-filter is case-insensitive for defense-in-depth: producers
      // (ingest/command/observe) normalise to lowercase before storeFact, but
      // direct storeFact callers (tests, pre-swap KB) may not.
      return rows
        .map(rowToFact)
        .filter((f) => f.entities.some((e) => e.trim().toLowerCase() === needle));
    },

    markFactSuperseded: async (oldFactId: string, newFactId: string) => {
      assertConnected(db);
      const info = db.prepare(
        'UPDATE facts SET is_latest=0, superseded_by=? WHERE id=?',
      ).run(newFactId, oldFactId);
      if ((info as { changes: number }).changes === 0) {
        throw new Error(`LibsqlStructuredStore: markFactSuperseded — unknown id ${oldFactId}`);
      }
    },

    // ── Fulltext ──────────────────────────────────────────────────────────

    searchFulltext: async (
      query: string,
      opts?: FulltextSearchOpts,
    ): Promise<FulltextMatch[]> => {
      assertConnected(db);
      const built = buildFtsQuery(query);
      if (!built) return [];
      const { ftsQuery, tokens } = built;
      const topK = opts?.topK ?? 50;
      const selectedFields = (opts?.fields ?? FTS_FIELDS) as readonly FulltextField[];

      // Build a join against memories for tier + scope filters. FTS5
      // matching stays purely on the virtual table.
      const where: string[] = ['memories_fts MATCH ?'];
      const params: unknown[] = [ftsQuery];
      if (opts?.tier) {
        where.push('m.tier = ?');
        params.push(opts.tier);
      }
      const sql = `
        SELECT f.memory_id AS memory_id,
               f.title    AS title,
               f.summary  AS summary,
               f.content  AS content,
               f.tags     AS tags,
               f.rank     AS rank,
               m.scopes   AS scopes
        FROM memories_fts f
        JOIN memories m ON m.id = f.memory_id
        WHERE ${where.join(' AND ')}
        ORDER BY f.rank
        LIMIT ?
      `;
      params.push(topK);
      const rows = db.prepare(sql).all(...params) as Row[];

      // Scope filter (JSON comparison can't be pushed into SQL portably).
      let filteredRows = rows;
      if (opts?.scopes) {
        const wanted = opts.scopes;
        filteredRows = rows.filter((row) => {
          if (!row.scopes) return false;
          const ms = p<Record<string, unknown>>(row.scopes as string) ?? {};
          if (wanted.org_id !== undefined && ms.org_id !== wanted.org_id) return false;
          if (wanted.project_id !== undefined && ms.project_id !== wanted.project_id) return false;
          return true;
        });
      }

      return filteredRows.map<FulltextMatch>((row) => ({
        memoryId: row.memory_id as string,
        score: normalizeRank(row.rank as number),
        matchedFields: detectMatchedFields(row, tokens, selectedFields),
      }));
    },

    // v1.0.0 — direct fact-level FTS via the facts_fts virtual table.
    searchFactsFulltext: async (
      query: string,
      opts?: FactsFulltextSearchOpts,
    ): Promise<FactsFulltextMatch[]> => {
      assertConnected(db);
      const built = buildFtsQuery(query);
      if (!built) return [];
      const { ftsQuery, tokens } = built;
      const topK = opts?.topK ?? 50;
      const selectedFields = (opts?.fields ?? FACTS_FTS_FIELDS) as readonly FactsFulltextField[];
      const latestOnly = opts?.latestOnly ?? true;

      const where: string[] = ['facts_fts MATCH ?'];
      const params: unknown[] = [ftsQuery];
      if (latestOnly) {
        where.push('fa.is_latest = 1');
      }
      if (opts?.category) {
        where.push('fa.category = ?');
        params.push(opts.category);
      }
      const sql = `
        SELECT ft.fact_id  AS fact_id,
               ft.content  AS content,
               ft.entities AS entities,
               ft.rank     AS rank,
               fa.scopes   AS scopes
        FROM facts_fts ft
        JOIN facts fa ON fa.id = ft.fact_id
        WHERE ${where.join(' AND ')}
        ORDER BY ft.rank
        LIMIT ?
      `;
      params.push(topK);
      const rows = db.prepare(sql).all(...params) as Row[];

      let filteredRows = rows;
      if (opts?.scopes) {
        const wanted = opts.scopes;
        filteredRows = rows.filter((row) => {
          if (!row.scopes) return false;
          const fs = p<Record<string, unknown>>(row.scopes as string) ?? {};
          if (wanted.org_id !== undefined && fs.org_id !== wanted.org_id) return false;
          if (wanted.project_id !== undefined && fs.project_id !== wanted.project_id) return false;
          return true;
        });
      }

      return filteredRows.map<FactsFulltextMatch>((row) => {
        const matched: FactsFulltextField[] = [];
        for (const field of selectedFields) {
          const haystack = String(row[field] ?? '').toLowerCase();
          if (tokens.some((t) => haystack.includes(t))) matched.push(field);
        }
        return {
          factId: row.fact_id as string,
          score: normalizeRank(row.rank as number),
          matchedFields: matched,
          // v1.2.1 — pass content through so the kernel can compute content-only
          // word-match-ratio scoring (KB-faithful, per ADR 011 port-first).
          content: String(row.content ?? ''),
        };
      });
    },

    // ── Contradiction ─────────────────────────────────────────────────────

    storeContradiction: async (contradiction: Contradiction) => {
      assertConnected(db);
      db.prepare(`
        INSERT OR REPLACE INTO contradictions
          (id, fact_a_id, fact_b_id, status, rationale, resolution, created_at)
        VALUES (@id, @fact_a_id, @fact_b_id, @status, @rationale, @resolution, @created_at)
      `).run({
        id: contradiction.id,
        fact_a_id: contradiction.factAId,
        fact_b_id: contradiction.factBId,
        status: contradiction.status,
        rationale: contradiction.rationale ?? null,
        resolution: contradiction.resolution ?? null,
        created_at: contradiction.createdAt,
      });
    },

    listContradictions: async (status?: Contradiction['status']) => {
      assertConnected(db);
      if (status !== undefined) {
        const rows = db.prepare(
          'SELECT * FROM contradictions WHERE status=?',
        ).all(status) as Row[];
        return rows.map(rowToContradiction);
      }
      const rows = db.prepare('SELECT * FROM contradictions').all() as Row[];
      return rows.map(rowToContradiction);
    },

    // ── Insight ───────────────────────────────────────────────────────────

    storeInsight: async (insight: Insight) => {
      assertConnected(db);
      db.prepare(`
        INSERT OR REPLACE INTO insights
          (id, entity_id, type, statement, supporting_fact_ids, confidence, created_at)
        VALUES (@id, @entity_id, @type, @statement, @supporting_fact_ids, @confidence, @created_at)
      `).run({
        id: insight.id,
        entity_id: insight.entityId ?? null,
        type: insight.type,
        statement: insight.statement,
        supporting_fact_ids: j(insight.supportingFactIds),
        confidence: insight.confidence,
        created_at: insight.createdAt,
      });
    },

    listInsights: async (entityId?: string) => {
      assertConnected(db);
      if (entityId !== undefined) {
        const rows = db.prepare(
          'SELECT * FROM insights WHERE entity_id=?',
        ).all(entityId) as Row[];
        return rows.map(rowToInsight);
      }
      const rows = db.prepare('SELECT * FROM insights').all() as Row[];
      return rows.map(rowToInsight);
    },

    // ── EntityProfile ─────────────────────────────────────────────────────

    storeEntityProfile: async (profile: EntityProfile) => {
      assertConnected(db);
      db.prepare(`
        INSERT OR REPLACE INTO entity_profiles
          (id, entity_id, static_facts, dynamic_context, narrative_prose, related_entity_ids)
        VALUES (@id, @entity_id, @static_facts, @dynamic_context, @narrative_prose, @related_entity_ids)
      `).run({
        id: profile.id,
        entity_id: profile.entityId,
        static_facts: j(profile.staticFacts),
        dynamic_context: profile.dynamicContext,
        narrative_prose: profile.narrativeProse ?? null,
        related_entity_ids: j(profile.relatedEntityIds),
      });
    },

    getEntityProfile: async (entityId: string) => {
      assertConnected(db);
      const row = db.prepare(
        'SELECT * FROM entity_profiles WHERE entity_id=?',
      ).get(entityId) as Row | undefined;
      return row ? rowToEntityProfile(row) : null;
    },

    // ── AgentSelf ─────────────────────────────────────────────────────────

    getAgentSelf: async () => {
      assertConnected(db);
      const row = db.prepare("SELECT * FROM agent_self WHERE id='self'").get() as Row | undefined;
      if (!row) return null;
      return {
        memoryBlocks: p(row.memory_blocks as string),
        history: p(row.history as string),
      } satisfies AgentSelf;
    },

    updateAgentSelf: async (self: AgentSelf) => {
      assertConnected(db);
      db.prepare(`
        INSERT OR REPLACE INTO agent_self (id, memory_blocks, history)
        VALUES ('self', @memory_blocks, @history)
      `).run({
        memory_blocks: j(self.memoryBlocks),
        history: j(self.history),
      });
    },

    // ── Transaction ───────────────────────────────────────────────────────
    // v1.2.0 — atomic multi-step writes. better-sqlite3's underlying
    // statements are synchronous so we drive BEGIN/COMMIT manually around
    // the async `fn` body. fn receives the same store instance; nested
    // transactions are not supported (libsql/SQLite has no SAVEPOINT-style
    // nesting in this wrapper).
    transaction: async <T>(fn: (tx: StructuredStore) => Promise<T>): Promise<T> => {
      assertConnected(db);
      db.exec('BEGIN');
      try {
        const result = await fn(store);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw err;
      }
    },
  };
  return store;
}
