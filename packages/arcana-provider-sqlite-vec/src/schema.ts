export function makeDDL(dimensions: number): string {
  return `
CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
  embedding float[${dimensions}]
);

CREATE TABLE IF NOT EXISTS vec_metadata (
  id TEXT PRIMARY KEY,
  rowid_ref INTEGER UNIQUE NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
`;
}
