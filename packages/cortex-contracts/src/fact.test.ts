import { describe, it, expect } from 'vitest';
import {
  FactSchema,
  ContradictionSchema,
  type Fact,
  type Contradiction,
} from './fact.js';

describe('FactSchema (sentence-form + optional triple decomposition)', () => {
  it('round-trips a sentence-only Fact (no attribute/value)', () => {
    const sample: Fact = {
      id: 'fact_1',
      fact: 'John works at Acme as the CTO',
      entities: ['John'],
      category: 'general',      confidence: 0.85,
      sourceType: 'ai-extraction',
      createdAt: '2026-05-18T08:00:00.000Z',
      isLatest: true,
    };
    expect(FactSchema.parse(sample)).toEqual(sample);
  });

  it('round-trips a Fact with full triple decomposition', () => {
    const sample: Fact = {
      id: 'fact_2',
      fact: 'David lives in Sydney',
      entities: ['David'],
      category: 'general',      attribute: 'location',
      value: 'Sydney',
      confidence: 0.95,
      sourceType: 'chat',
      createdAt: '2026-05-18T08:00:00.000Z',
      isLatest: true,
    };
    expect(FactSchema.parse(sample)).toEqual(sample);
  });

  it('round-trips a Fact with full optional fields', () => {
    const sample: Fact = {
      id: 'fact_3',
      fact: 'David is a senior engineer at Anthropic',
      entities: ['David'],
      category: 'general',      attribute: 'role',
      value: 'senior engineer',
      confidence: 0.8,
      sourceType: 'ai-extraction',
      createdAt: '2026-05-18T08:00:00.000Z',
      lastReinforcedAt: '2026-05-18T10:00:00.000Z',
      expiresAt: '2027-05-18T00:00:00.000Z',
      isLatest: false,
      supersededBy: 'fact_4',
      surprisalScore: 0.3,
      scopes: { org_id: 'org_1', project_id: 'proj_1' },
    };
    expect(FactSchema.parse(sample)).toEqual(sample);
  });

  it('requires fact (sentence form)', () => {
    expect(() =>
      FactSchema.parse({
        id: 'f',
        entities: ['David'],
        category: 'general',        confidence: 0.9,
        sourceType: 'chat',
        createdAt: '2026-05-18T08:00:00.000Z',
        isLatest: true,
      }),
    ).toThrow();
  });

  it('requires entity', () => {
    expect(() =>
      FactSchema.parse({
        id: 'f',
        fact: 'David lives in Sydney',
        confidence: 0.9,
        sourceType: 'chat',
        createdAt: '2026-05-18T08:00:00.000Z',
        isLatest: true,
      }),
    ).toThrow();
  });
});

describe('ContradictionSchema', () => {
  it('round-trips a minimal Contradiction (no rationale, no resolution)', () => {
    const sample: Contradiction = {
      id: 'cont_1',
      factAId: 'fact_1',
      factBId: 'fact_2',
      status: 'pending',
      createdAt: '2026-05-18T08:00:00.000Z',
    };
    expect(ContradictionSchema.parse(sample)).toEqual(sample);
  });

  it('round-trips a Contradiction with rationale (detection input)', () => {
    const sample: Contradiction = {
      id: 'cont_2',
      factAId: 'fact_1',
      factBId: 'fact_2',
      status: 'pending',
      rationale: 'Fact A says David lives in Sydney; Fact B says David lives in Melbourne. Mutually exclusive locations.',
      createdAt: '2026-05-18T08:00:00.000Z',
    };
    expect(ContradictionSchema.parse(sample)).toEqual(sample);
  });

  it('round-trips a Contradiction with rationale and resolution (full lifecycle)', () => {
    const sample: Contradiction = {
      id: 'cont_3',
      factAId: 'fact_1',
      factBId: 'fact_2',
      status: 'user-resolved',
      rationale: 'Conflicting location facts.',
      resolution: 'User confirmed Fact B is current; Fact A superseded.',
      createdAt: '2026-05-18T08:00:00.000Z',
    };
    expect(ContradictionSchema.parse(sample)).toEqual(sample);
  });
});

import { FactCategorySchema, widenLegacyFact, type LegacyFact } from './fact.js';

describe('FactCategorySchema (v1.0.0)', () => {
  it('has 8 members verbatim from KB fact-store.ts:38-46', () => {
    expect(FactCategorySchema.options).toEqual([
      'biographical', 'preference', 'event', 'relationship',
      'temporal', 'opinion', 'plan', 'general',
    ]);
  });

  it('rejects unknown category', () => {
    expect(() => FactCategorySchema.parse('unknown-category')).toThrow();
  });
});

describe('FactSchema v1.0.0 deepening (per ADR 013)', () => {
  it('round-trips a Fact with entities array, sourceMemoryId, category', () => {
    const sample: Fact = {
      id: 'f1',
      fact: 'Alice met Bob in Paris',
      entities: ['Alice', 'Bob', 'Paris'],
      confidence: 0.9,
      sourceType: 'ai-extraction',
      sourceMemoryId: 'mem_1',
      sourcePath: '/notes/2026-01.md',
      sourceConversationId: 'conv_abc',
      category: 'event',
      createdAt: '2026-05-22T00:00:00.000Z',
      isLatest: true,
    };
    expect(FactSchema.parse(sample)).toEqual(sample);
  });

  it('requires entities with at least one element', () => {
    expect(() =>
      FactSchema.parse({
        id: 'f',
        fact: 'X',
        entities: [],
        confidence: 0.9,
        sourceType: 'chat',
        category: 'general',
        createdAt: '2026-05-22T00:00:00.000Z',
        isLatest: true,
      }),
    ).toThrow();
  });

  it('requires category', () => {
    expect(() =>
      FactSchema.parse({
        id: 'f',
        fact: 'X',
        entities: ['Alice'],
        confidence: 0.9,
        sourceType: 'chat',
        createdAt: '2026-05-22T00:00:00.000Z',
        isLatest: true,
      }),
    ).toThrow();
  });
});

describe('widenLegacyFact (v0.x → v1.0.0 migration)', () => {
  it('wraps single entity into entities array and defaults category to general', () => {
    const legacy: LegacyFact = {
      id: 'f1',
      fact: 'Alice lives in Paris',
      entity: 'Alice',
      confidence: 0.9,
      sourceType: 'chat',
      createdAt: '2026-05-22T00:00:00.000Z',
      isLatest: true,
    };
    const widened = widenLegacyFact(legacy);
    expect(widened.entities).toEqual(['Alice']);
    expect(widened.category).toBe('general');
    expect(FactSchema.parse(widened)).toEqual(widened);
  });

  it('preserves attribute/value/scopes when widening', () => {
    const legacy: LegacyFact = {
      id: 'f2',
      fact: 'David is CTO of Acme',
      entity: 'David',
      attribute: 'role',
      value: 'CTO',
      confidence: 0.85,
      sourceType: 'ai-extraction',
      createdAt: '2026-05-22T00:00:00.000Z',
      isLatest: true,
      scopes: { org_id: 'org_1' },
    };
    const widened = widenLegacyFact(legacy);
    expect(widened.attribute).toBe('role');
    expect(widened.value).toBe('CTO');
    expect(widened.scopes).toEqual({ org_id: 'org_1' });
  });
});
