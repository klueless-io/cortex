import { describe, it, expect, vi } from 'vitest';
import { createNoopLogger, type Logger } from './logger.js';

describe('Logger interface', () => {
  it('createNoopLogger returns an object with all four methods', () => {
    const logger = createNoopLogger();
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('noop logger discards calls without throwing', () => {
    const logger = createNoopLogger();
    expect(() => {
      logger.debug('hello');
      logger.info('with ctx', { user: 'david' });
      logger.warn('warn ctx', {});
      logger.error('error ctx', { code: 500 });
    }).not.toThrow();
  });

  it('a Logger-conforming object can be constructed via spies', () => {
    // Demonstrates the interface contract — any object with debug/info/warn/error
    // satisfies Logger. Used by consumers to inject Pino, console, or a test spy.
    const spy: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    spy.info('hello', { from: 'test' });
    expect(spy.info).toHaveBeenCalledWith('hello', { from: 'test' });
  });
});
