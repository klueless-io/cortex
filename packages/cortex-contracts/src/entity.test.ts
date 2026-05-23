import { describe, it, expect } from 'vitest';
import { EntitySchema, type Entity } from './entity.js';

describe('EntitySchema', () => {
  it('round-trips a valid Entity', () => {
    const sample: Entity = {
      id: 'ent_1',
      name: 'Anthropic',
      type: 'company',
      mentionCount: 12,
      scopes: { org_id: 'org_1' },
    };
    expect(EntitySchema.parse(sample)).toEqual(sample);
  });

  it('rejects an unknown entity type', () => {
    expect(() =>
      EntitySchema.parse({
        id: 'ent_2',
        name: 'Banana',
        type: 'food',
        mentionCount: 1,
      }),
    ).toThrow();
  });
});
