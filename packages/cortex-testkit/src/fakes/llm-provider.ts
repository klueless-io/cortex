import type {
  LLMProvider,
  LLMCompleteOpts,
} from '@kybernesis/cortex-contracts';

/**
 * Echo LLMProvider fake. Returns a deterministic transformation of the
 * prompt. Useful for asserting "an LLM call happened" and "the system
 * prompt was passed through" without actually invoking a real model.
 *
 * The transformation prepends a marker so test assertions can distinguish
 * the fake output from a real model output.
 */
export function createFakeLLMProvider(): LLMProvider {
  return {
    model: 'fake-echo',
    complete: async (prompt: string, opts?: LLMCompleteOpts) => {
      const sys = opts?.system ? `[sys: ${opts.system}]\n` : '';
      return `[fake-echo]\n${sys}${prompt}`;
    },
  };
}
