import { describe, it, expect } from 'vitest';
import { NotImplementedError } from './errors.js';

describe('NotImplementedError', () => {
  it('is a real Error subclass', () => {
    const err = new NotImplementedError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(NotImplementedError);
  });

  it('preserves the message', () => {
    const err = new NotImplementedError('storeMemory is a stub');
    expect(err.message).toBe('storeMemory is a stub');
  });

  it('has name "NotImplementedError"', () => {
    expect(new NotImplementedError('x').name).toBe('NotImplementedError');
  });
});
