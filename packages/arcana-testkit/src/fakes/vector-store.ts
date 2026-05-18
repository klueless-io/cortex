import type {
  VectorStore,
  VectorItem,
  VectorQueryOpts,
  VectorMatch,
} from '@kybernesisai/arcana-contracts';

/**
 * In-memory VectorStore fake. Vector query returns the first `topK` matches
 * with a deterministic cosine-similarity-ish score based on dot product.
 * Sufficient for "the vector path was called" assertions; not a realistic
 * ANN benchmark.
 */
export function createFakeVectorStore(): VectorStore {
  const items = new Map<string, VectorItem>();
  let connected = false;

  return {
    connect: async () => {
      connected = true;
    },
    disconnect: async () => {
      connected = false;
    },

    upsert: async (newItems: VectorItem[]) => {
      if (!connected) throw new Error('fake VectorStore: not connected');
      for (const item of newItems) items.set(item.id, item);
    },

    query: async (
      vector: number[],
      opts?: VectorQueryOpts,
    ): Promise<VectorMatch[]> => {
      const topK = opts?.topK ?? 10;
      const matches: VectorMatch[] = [];
      for (const item of items.values()) {
        let score = 0;
        const len = Math.min(vector.length, item.vector.length);
        for (let i = 0; i < len; i++) score += (vector[i] ?? 0) * (item.vector[i] ?? 0);
        matches.push({ id: item.id, score, metadata: item.metadata });
      }
      matches.sort((a, b) => b.score - a.score);
      return matches.slice(0, topK);
    },

    delete: async (ids: string[]) => {
      for (const id of ids) items.delete(id);
    },
  };
}
