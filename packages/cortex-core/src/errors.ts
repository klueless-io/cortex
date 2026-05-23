/**
 * Thrown by stubbed kernel operations until their v0.x implementation lands.
 * Real Cortex usage at v0.1 will hit this — that's expected; v0.1 is the
 * scaffold milestone.
 */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}
