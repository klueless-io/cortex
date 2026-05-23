/**
 * @kybernesis/cortex-provider-llm-claude-code
 *
 * Subprocess-based LLMProvider that wraps the Claude Code CLI.
 *
 * Port of KyberBot's `claude.ts → completeSubprocess` path:
 *   /Users/davidcruwys/dev/kybernesis/kyberbot/packages/cli/src/claude.ts
 *
 * Per ADR 011 (port-first) the empirical KB pattern is the source of truth.
 * Per ADR 012 (LLM provider architecture) this is the subprocess-transport
 * provider; HTTP-transport variants live in `cortex-provider-llm-http`.
 *
 * Sunset note: the `claude -p` invocation pattern is scheduled for
 * deprecation (mid-2026). When the replacement lands, the internals of
 * this provider migrate; the `LLMProvider` contract stays stable.
 */

import { spawn } from 'node:child_process';
import type { LLMProvider, LLMCompleteOpts } from '@kybernesis/cortex-contracts';

export type ClaudeCodeModel = 'haiku' | 'sonnet' | 'opus';

export interface ClaudeCodeProviderOptions {
  /** Binary to spawn. Defaults to 'claude'. */
  binary?: string;
  /** Default model shorthand. Defaults to 'haiku'. */
  defaultModel?: ClaudeCodeModel;
  /**
   * Working directory for the spawned subprocess. Claude Code attributes
   * the session file to the project corresponding to this directory; pass
   * an agent root in fleet scenarios. (KB claude.ts:212-216.)
   */
  cwd?: string;
  /** Optional debug logger. Noop by default. */
  logger?: { debug: (msg: string, ctx?: unknown) => void };
}

/**
 * Model shorthand → full model ID. Mirrors KB claude.ts:64-68.
 * Update when Anthropic publishes new minor versions — the shorthand
 * resolves to the current latest model ID here.
 */
export const MODEL_IDS: Record<ClaudeCodeModel, string> = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
};

const NOOP_LOGGER = { debug: (_msg: string, _ctx?: unknown): void => undefined };

/**
 * Factory for a subprocess-backed LLMProvider.
 *
 * The returned provider implements `complete(prompt, opts?)`:
 *   - spawns `<binary> --print - --dangerously-skip-permissions --model <id> [--system-prompt <X>]`
 *   - pipes the prompt to stdin (KB claude.ts:220-223 — argv would hit ARG_MAX)
 *   - returns trimmed stdout on exit code 0
 *   - rejects with the stderr preview on non-zero exit or spawn ENOENT
 *
 * Per-call `opts.system` and `opts.maxTokens` are honored where the CLI
 * supports them. `opts.temperature` is currently ignored — `claude -p` has
 * no temperature flag; SDK-mode HTTP providers do.
 */
export function createClaudeCodeLLMProvider(
  opts: ClaudeCodeProviderOptions = {},
): LLMProvider {
  const binary = opts.binary ?? 'claude';
  const defaultModel: ClaudeCodeModel = opts.defaultModel ?? 'haiku';
  const cwd = opts.cwd;
  const logger = opts.logger ?? NOOP_LOGGER;

  const modelId = MODEL_IDS[defaultModel];

  return {
    model: modelId,

    complete(prompt: string, callOpts: LLMCompleteOpts = {}): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        const args: string[] = ['--print', '-', '--dangerously-skip-permissions'];

        if (callOpts.system) {
          args.push('--system-prompt', callOpts.system);
        }

        args.push('--model', modelId);

        logger.debug('claude-code:spawn', { binary, args, cwd });

        const proc = spawn(binary, args, {
          env: {
            ...process.env,
            // Unset to avoid Claude Code detecting nested invocation.
            // KB claude.ts:208-210.
            CLAUDECODE: '',
            CLAUDE_CODE_ENTRYPOINT: '',
          },
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        if (proc.stdin) {
          proc.stdin.write(prompt);
          proc.stdin.end();
        }

        if (proc.stdout) {
          proc.stdout.on('data', (chunk: Buffer) => {
            stdoutChunks.push(chunk);
          });
        }

        if (proc.stderr) {
          proc.stderr.on('data', (chunk: Buffer) => {
            stderrChunks.push(chunk);
          });
        }

        proc.on('error', (err: NodeJS.ErrnoException) => {
          stdoutChunks.length = 0;
          stderrChunks.length = 0;
          if (err.code === 'ENOENT') {
            reject(
              new Error(
                `Failed to spawn ${binary}: not found on PATH. Is Claude Code installed?`,
              ),
            );
            return;
          }
          reject(new Error(`Failed to spawn ${binary}: ${err.message}`));
        });

        proc.on('close', (code: number | null) => {
          const stdout = Buffer.concat(stdoutChunks).toString().trim();
          const stderr = Buffer.concat(stderrChunks).toString();
          stdoutChunks.length = 0;
          stderrChunks.length = 0;

          if (code === 0) {
            resolve(stdout);
            return;
          }

          const stderrPreview = stderr.slice(0, 500) || `exit code ${code}`;
          reject(new Error(`claude subprocess failed: ${stderrPreview}`));
        });
      });
    },
  };
}
