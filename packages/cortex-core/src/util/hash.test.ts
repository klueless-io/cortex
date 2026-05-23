import { describe, it, expect } from 'vitest';
import { djb2Hash } from './hash.js';

describe('djb2Hash', () => {
  it('returns the same hash for the same input', () => {
    expect(djb2Hash('hello world')).toBe(djb2Hash('hello world'));
  });

  it('returns different hashes for different inputs', () => {
    expect(djb2Hash('a')).not.toBe(djb2Hash('b'));
  });

  it('returns an 8-char hex string', () => {
    expect(djb2Hash('anything')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('handles empty string', () => {
    expect(djb2Hash('')).toMatch(/^[0-9a-f]{8}$/);
  });
});
