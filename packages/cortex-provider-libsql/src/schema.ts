export const DDL = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  priority REAL NOT NULL DEFAULT 0.5,
  tier TEXT NOT NULL DEFAULT 'warm',
  decay_score REAL NOT NULL DEFAULT 0,
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_accessed_at TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  is_latest INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT,
  scopes TEXT
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  text TEXT NOT NULL,
  vector_id TEXT,
  layer TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 0,
  scopes TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  confidence REAL NOT NULL,
  shared_tags TEXT NOT NULL DEFAULT '[]',
  rationale TEXT,
  method TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_verified_at TEXT
);

CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  fact TEXT NOT NULL,
  entities_json TEXT NOT NULL DEFAULT '[]',
  attribute TEXT,
  value TEXT,
  confidence REAL NOT NULL,
  source_type TEXT NOT NULL,
  source_memory_id TEXT,
  source_path TEXT,
  source_conversation_id TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  created_at TEXT NOT NULL,
  last_reinforced_at TEXT,
  expires_at TEXT,
  is_latest INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT,
  surprisal_score REAL,
  scopes TEXT
);

CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category);
CREATE INDEX IF NOT EXISTS idx_facts_source_memory_id ON facts(source_memory_id);
CREATE INDEX IF NOT EXISTS idx_facts_source_conv ON facts(source_conversation_id);
CREATE INDEX IF NOT EXISTS idx_facts_is_latest ON facts(is_latest);

CREATE TABLE IF NOT EXISTS contradictions (
  id TEXT PRIMARY KEY,
  fact_a_id TEXT NOT NULL,
  fact_b_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  rationale TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  entity_id TEXT,
  type TEXT NOT NULL,
  statement TEXT NOT NULL,
  supporting_fact_ids TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_profiles (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL UNIQUE,
  static_facts TEXT NOT NULL DEFAULT '[]',
  dynamic_context TEXT NOT NULL DEFAULT '',
  narrative_prose TEXT,
  related_entity_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS agent_self (
  id TEXT PRIMARY KEY,
  memory_blocks TEXT NOT NULL DEFAULT '[]',
  history TEXT NOT NULL DEFAULT '[]'
);

-- Fulltext index over memories. Mirrors title/summary/content/tags.
-- memory_id is UNINDEXED so it doesn't participate in MATCH but can be
-- selected and joined back to the canonical memories table for filters.
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  memory_id UNINDEXED,
  title,
  summary,
  content,
  tags,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Sync triggers — keep memories_fts in lockstep with memories.
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts (memory_id, title, summary, content, tags)
  VALUES (new.id, new.title, new.summary, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  DELETE FROM memories_fts WHERE memory_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  DELETE FROM memories_fts WHERE memory_id = old.id;
  INSERT INTO memories_fts (memory_id, title, summary, content, tags)
  VALUES (new.id, new.title, new.summary, new.content, new.tags);
END;

-- v1.0.0 — Fulltext index over facts (mirrors KB fact-store.ts:213-225).
-- fact_id is UNINDEXED so it doesn't participate in MATCH but can be
-- selected and joined back to the canonical facts table for filters.
CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
  fact_id UNINDEXED,
  content,
  entities,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
  INSERT INTO facts_fts (fact_id, content, entities)
  VALUES (new.id, new.fact, new.entities_json);
END;

CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
  DELETE FROM facts_fts WHERE fact_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
  DELETE FROM facts_fts WHERE fact_id = old.id;
  INSERT INTO facts_fts (fact_id, content, entities)
  VALUES (new.id, new.fact, new.entities_json);
END;
`;
