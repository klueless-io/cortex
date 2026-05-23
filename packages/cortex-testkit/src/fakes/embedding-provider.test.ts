import { describe, it, expect } from 'vitest';
import { createFakeEmbeddingProvider } from './embedding-provider.js';

describe('createFakeEmbeddingProvider', () => {
  it('produces vectors of the declared dimensions', async () => {
    const e = createFakeEmbeddingProvider();
    const v = await e.embed('hello');
    expect(v.length).toBe(e.dimensions);
  });

  it('is deterministic — same input → same vector', async () => {
    const e = createFakeEmbeddingProvider();
    const a = await e.embed('the same text');
    const b = await e.embed('the same text');
    expect(a).toEqual(b);
  });

  it('embedBatch returns a vector per input', async () => {
    const e = createFakeEmbeddingProvider();
    const vs = await e.embedBatch(['a', 'b', 'c']);
    expect(vs.length).toBe(3);
    expect(vs[0]?.length).toBe(e.dimensions);
  });
});
