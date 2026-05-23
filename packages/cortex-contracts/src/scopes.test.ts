import { describe, it, expect } from 'vitest';
import { ScopesSchema, type Scopes } from './scopes.js';

describe('ScopesSchema', () => {
  it('round-trips an empty Scopes object', () => {
    const sample: Scopes = {};
    expect(ScopesSchema.parse(sample)).toEqual(sample);
  });

  it('round-trips a fully populated Scopes object', () => {
    const sample: Scopes = {
      org_id: 'org_1',
      project_id: 'proj_1',
      connection_id: 'conn_1',
      source_did: 'did:example:1',
      classification: 'internal',
    };
    expect(ScopesSchema.parse(sample)).toEqual(sample);
  });

  it('rejects unknown keys (strict mode)', () => {
    expect(() =>
      ScopesSchema.parse({ org_id: 'x', extraneous: 'bad' }),
    ).toThrow();
  });
});
