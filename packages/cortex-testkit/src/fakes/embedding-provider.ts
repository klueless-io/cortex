import type { EmbeddingProvider } from '@kybernesis/cortex-contracts';

/**
 * Deterministic byte-hash EmbeddingProvider fake. Maps text → 256-dim vector
 * by hashing character codes. Same input → same vector. No semantic meaning
 * — sufficient for "embed was called and produced a vector of the expected
 * dimensions" assertions only.
 *
 * Do not use this as a real fallback in production. (See cortex-spec.md §12
 * — the AgentDB fallback embedding was flagged as a footgun.)
 */
export function createFakeEmbeddingProvider(): EmbeddingProvider {
  const dimensions = 256;

  function embedSync(text: string): number[] {
    const vec = new Array<number>(dimensions).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % dimensions] = (vec[i % dimensions] ?? 0) + (text.charCodeAt(i) % 97) / 97;
    }
    // L2-normalize
    let mag = 0;
    for (const v of vec) mag += v * v;
    mag = Math.sqrt(mag) || 1;
    return vec.map((v) => v / mag);
  }

  return {
    model: 'fake-byte-hash',
    dimensions,
    embed: async (text) => embedSync(text),
    embedBatch: async (texts) => texts.map(embedSync),
  };
}
