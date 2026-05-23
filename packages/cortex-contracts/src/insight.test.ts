import { describe, it, expect } from 'vitest';
import {
  InsightSchema,
  EntityProfileSchema,
  ProfileEntrySchema,
  type Insight,
  type EntityProfile,
  type ProfileEntry,
} from './insight.js';

describe('InsightSchema', () => {
  it('round-trips a valid deduction insight', () => {
    const sample: Insight = {
      id: 'ins_1',
      entityId: 'ent_1',
      type: 'deduction',
      statement: 'David books meetings on Tuesdays',
      supportingFactIds: ['fact_1', 'fact_2'],
      confidence: 0.75,
      createdAt: '2026-05-18T08:00:00.000Z',
    };
    expect(InsightSchema.parse(sample)).toEqual(sample);
  });

  it('rejects an unknown insight type', () => {
    expect(() =>
      InsightSchema.parse({
        id: 'ins_2',
        type: 'speculation',
        statement: 'maybe',
        supportingFactIds: [],
        confidence: 0.5,
        createdAt: '2026-05-18T08:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('ProfileEntrySchema', () => {
  it('round-trips a value-only entry (flat-string migration path)', () => {
    const sample: ProfileEntry = { value: 'name=Anthropic' };
    expect(ProfileEntrySchema.parse(sample)).toEqual(sample);
  });

  it('round-trips a fully-populated entry', () => {
    const sample: ProfileEntry = {
      value: 'type=company',
      factId: 'fact_1',
      confidence: 0.9,
      recordedAt: '2026-05-19T00:00:00.000Z',
    };
    expect(ProfileEntrySchema.parse(sample)).toEqual(sample);
  });

  it('rejects an empty value', () => {
    expect(() => ProfileEntrySchema.parse({ value: '' })).toThrow();
  });

  it('rejects confidence out of range', () => {
    expect(() => ProfileEntrySchema.parse({ value: 'x', confidence: 1.5 })).toThrow();
  });

  it('rejects unknown keys (strict mode)', () => {
    expect(() => ProfileEntrySchema.parse({ value: 'x', extra: true })).toThrow();
  });
});

describe('EntityProfileSchema', () => {
  it('round-trips a valid EntityProfile with ProfileEntry staticFacts', () => {
    const sample: EntityProfile = {
      id: 'prof_1',
      entityId: 'ent_1',
      staticFacts: [
        { value: 'name=Anthropic' },
        { value: 'type=company', factId: 'fact_1', confidence: 0.95 },
      ],
      dynamicContext: 'Recent work: Claude Opus 4.7 release',
      narrativeProse: 'Anthropic is an AI safety company.',
      relatedEntityIds: ['ent_2', 'ent_3'],
    };
    expect(EntityProfileSchema.parse(sample)).toEqual(sample);
  });

  it('rejects a raw string in staticFacts (no longer valid)', () => {
    expect(() =>
      EntityProfileSchema.parse({
        id: 'prof_2',
        entityId: 'ent_1',
        staticFacts: ['name=Anthropic'],
        dynamicContext: '',
        relatedEntityIds: [],
      }),
    ).toThrow();
  });
});
