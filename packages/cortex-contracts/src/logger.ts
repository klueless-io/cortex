/**
 * Logger interface. Cortex never imports a concrete logger (no Pino, Winston,
 * Bunyan, etc.) — consumers inject their own logger that satisfies this shape.
 *
 * The minimal surface mirrors KyberBot's existing logger and is satisfied by
 * Pino, console, or any other logging library with a trivial adapter.
 */
export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

/**
 * A no-op logger. Discards every message. Default fallback when no logger is
 * injected into createCortex(). Useful in tests where log assertions aren't
 * needed.
 */
export function createNoopLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}
