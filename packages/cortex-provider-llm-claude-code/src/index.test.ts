import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock spawn before importing the module under test
vi.mock('node:child_process', () => {
  return { spawn: vi.fn() };
});

import { spawn } from 'node:child_process';
import {
  createClaudeCodeLLMProvider,
  MODEL_IDS,
} from './index.js';

interface FakeProc extends EventEmitter {
  stdin: { write: (s: string) => void; end: () => void; written: string[] };
  stdout: EventEmitter;
  stderr: EventEmitter;
}

interface SpawnCall {
  binary: string;
  args: string[];
  opts: { cwd?: string; env?: Record<string, string>; stdio?: unknown };
  proc: FakeProc;
}

let lastSpawn: SpawnCall | null = null;

function makeFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  const written: string[] = [];
  proc.stdin = {
    write(s: string): void { written.push(s); },
    end(): void { /* noop */ },
    written,
  };
  return proc;
}

/** Drive a fake proc to a successful close emitting `stdoutText`. */
function succeed(proc: FakeProc, stdoutText: string): void {
  setImmediate(() => {
    proc.stdout.emit('data', Buffer.from(stdoutText));
    proc.emit('close', 0);
  });
}

/** Drive a fake proc to a non-zero exit with `stderrText`. */
function fail(proc: FakeProc, code: number, stderrText: string): void {
  setImmediate(() => {
    proc.stderr.emit('data', Buffer.from(stderrText));
    proc.emit('close', code);
  });
}

/** Drive a fake proc to emit a spawn error. */
function spawnError(proc: FakeProc, err: NodeJS.ErrnoException): void {
  setImmediate(() => {
    proc.emit('error', err);
  });
}

beforeEach(() => {
  lastSpawn = null;
  vi.mocked(spawn).mockReset();
  vi.mocked(spawn).mockImplementation(((binary: string, args: string[], opts: unknown) => {
    const proc = makeFakeProc();
    lastSpawn = {
      binary,
      args,
      opts: opts as SpawnCall['opts'],
      proc,
    };
    return proc as unknown as ReturnType<typeof spawn>;
  }) as unknown as typeof spawn);
});

describe('createClaudeCodeLLMProvider', () => {
  it('returns trimmed stdout on the happy path', async () => {
    const provider = createClaudeCodeLLMProvider();
    const promise = provider.complete('hello world');
    succeed(lastSpawn!.proc, '  the answer is 42  \n');
    await expect(promise).resolves.toBe('the answer is 42');
  });

  it('defaults to haiku model when no defaultModel supplied', async () => {
    const provider = createClaudeCodeLLMProvider();
    expect(provider.model).toBe(MODEL_IDS.haiku);
    const promise = provider.complete('q');
    succeed(lastSpawn!.proc, 'ok');
    await promise;
    const modelIdx = lastSpawn!.args.indexOf('--model');
    expect(modelIdx).toBeGreaterThanOrEqual(0);
    expect(lastSpawn!.args[modelIdx + 1]).toBe('claude-haiku-4-5');
  });

  it('maps sonnet shorthand to claude-sonnet-4-6', async () => {
    const provider = createClaudeCodeLLMProvider({ defaultModel: 'sonnet' });
    expect(provider.model).toBe('claude-sonnet-4-6');
    const promise = provider.complete('q');
    succeed(lastSpawn!.proc, 'ok');
    await promise;
    const modelIdx = lastSpawn!.args.indexOf('--model');
    expect(lastSpawn!.args[modelIdx + 1]).toBe('claude-sonnet-4-6');
  });

  it('maps opus shorthand to claude-opus-4-7', async () => {
    const provider = createClaudeCodeLLMProvider({ defaultModel: 'opus' });
    expect(provider.model).toBe('claude-opus-4-7');
    const promise = provider.complete('q');
    succeed(lastSpawn!.proc, 'ok');
    await promise;
    const modelIdx = lastSpawn!.args.indexOf('--model');
    expect(lastSpawn!.args[modelIdx + 1]).toBe('claude-opus-4-7');
  });

  it('honors factory-level cwd in spawn options', async () => {
    const provider = createClaudeCodeLLMProvider({ cwd: '/tmp/agent-root' });
    const promise = provider.complete('q');
    succeed(lastSpawn!.proc, 'ok');
    await promise;
    expect(lastSpawn!.opts.cwd).toBe('/tmp/agent-root');
  });

  it('passes the prompt via stdin (not argv) to avoid ARG_MAX', async () => {
    const provider = createClaudeCodeLLMProvider();
    const promise = provider.complete('a very long prompt');
    succeed(lastSpawn!.proc, 'ok');
    await promise;
    // Prompt must NOT appear in argv
    expect(lastSpawn!.args.includes('a very long prompt')).toBe(false);
    // Prompt must have been written to stdin
    expect(lastSpawn!.proc.stdin.written).toContain('a very long prompt');
    // And the stdin-marker `-` must be present in argv (per KB pattern)
    expect(lastSpawn!.args).toContain('-');
    expect(lastSpawn!.args).toContain('--print');
  });

  it('always passes --dangerously-skip-permissions (headless subprocess)', async () => {
    const provider = createClaudeCodeLLMProvider();
    const promise = provider.complete('q');
    succeed(lastSpawn!.proc, 'ok');
    await promise;
    expect(lastSpawn!.args).toContain('--dangerously-skip-permissions');
  });

  it('passes opts.system through --system-prompt', async () => {
    const provider = createClaudeCodeLLMProvider();
    const promise = provider.complete('q', { system: 'you are a poet' });
    succeed(lastSpawn!.proc, 'ok');
    await promise;
    const sysIdx = lastSpawn!.args.indexOf('--system-prompt');
    expect(sysIdx).toBeGreaterThanOrEqual(0);
    expect(lastSpawn!.args[sysIdx + 1]).toBe('you are a poet');
  });

  it('unsets CLAUDECODE / CLAUDE_CODE_ENTRYPOINT to avoid nested-invocation detection', async () => {
    const provider = createClaudeCodeLLMProvider();
    const promise = provider.complete('q');
    succeed(lastSpawn!.proc, 'ok');
    await promise;
    expect(lastSpawn!.opts.env?.CLAUDECODE).toBe('');
    expect(lastSpawn!.opts.env?.CLAUDE_CODE_ENTRYPOINT).toBe('');
  });

  it('rejects with stderr preview on non-zero exit', async () => {
    const provider = createClaudeCodeLLMProvider();
    const promise = provider.complete('q');
    fail(lastSpawn!.proc, 1, 'something went wrong');
    await expect(promise).rejects.toThrow(/something went wrong/);
  });

  it('rejects with a helpful message when binary is not found (ENOENT)', async () => {
    const provider = createClaudeCodeLLMProvider({ binary: 'no-such-bin' });
    const promise = provider.complete('q');
    const err: NodeJS.ErrnoException = Object.assign(new Error('spawn no-such-bin ENOENT'), {
      code: 'ENOENT',
    });
    spawnError(lastSpawn!.proc, err);
    await expect(promise).rejects.toThrow(/not found on PATH/);
  });

  it('honors a custom binary name', async () => {
    const provider = createClaudeCodeLLMProvider({ binary: '/usr/local/bin/claude-x' });
    const promise = provider.complete('q');
    succeed(lastSpawn!.proc, 'ok');
    await promise;
    expect(lastSpawn!.binary).toBe('/usr/local/bin/claude-x');
  });

  it('routes logger.debug on spawn', async () => {
    const debug = vi.fn();
    const provider = createClaudeCodeLLMProvider({ logger: { debug } });
    const promise = provider.complete('q');
    succeed(lastSpawn!.proc, 'ok');
    await promise;
    expect(debug).toHaveBeenCalledWith('claude-code:spawn', expect.objectContaining({
      binary: 'claude',
    }));
  });
});
