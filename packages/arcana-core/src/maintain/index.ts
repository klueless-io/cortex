import type {
  StructuredStore,
  VectorStore,
  EmbeddingProvider,
  LLMProvider,
  Scheduler,
  JobQueue,
  Logger,
  Scopes,
} from '@kybernesis/arcana-contracts';
import { DEFAULT_CONFIG, type SleepConfig } from './config.js';
import { runDecayMemories } from './steps/decay-memories.js';
import { runRefreshTags } from './steps/refresh-tags.js';
import { runConsolidateMemories } from './steps/consolidate-memories.js';
import { runLinkMemories } from './steps/link-memories.js';
import { runTierMemories } from './steps/tier-memories.js';
import { runSummarizeMemories } from './steps/summarize-memories.js';
import { runObserveConversations } from './steps/observe-conversations.js';
import { runRebuildUserProfile } from './steps/rebuild-user-profile.js';
import { runReasoning } from './steps/run-reasoning.js';
import { runCleanEntityGraph } from './steps/clean-entity-graph.js';

/**
 * KB's 10 sleep steps in execution order — ported per ADR 011 (port-first).
 *
 * Deferred to v2 sleep (Arcana-invented, not present in KB's pipeline):
 *   collectCandidates, ingestionValidation, extractFacts-in-sleep,
 *   detectContradictions, computeSurprisal
 * See docs/decisions/011-port-first-improve-later.md.
 */
export const SLEEP_STEPS = [
  'decayMemories',
  'refreshTags',
  'consolidateMemories',
  'linkMemories',
  'tierMemories',
  'summarizeMemories',
  'observeConversations',
  'rebuildUserProfile',
  'runReasoning',
  'cleanEntityGraph',
] as const;

export type SleepStep = (typeof SLEEP_STEPS)[number];

export interface SleepRunInput {
  scopes?: Scopes;
  /** Run only these steps (default: all). */
  steps?: SleepStep[];
  resume?: boolean;
}

export interface SleepRunResult {
  startedAt: string;
  finishedAt: string;
  stepsRun: SleepStep[];
  candidatesProcessed: number;
  /**
   * v1.2.0 — steps that completed with non-empty `errors[]`. They are
   * checkpointed as 'partial' and will be re-attempted on the next
   * `runSleepPipeline({resume: true})` call. Empty array means a fully
   * clean run.
   */
  partialSteps: SleepStep[];
}

export interface MaintainDeps {
  structured: StructuredStore;
  vector: VectorStore;
  embed: EmbeddingProvider;
  llm: LLMProvider;
  scheduler: Scheduler;
  queue: JobQueue;
  logger: Logger;
}

export interface MaintainApi {
  runSleepPipeline(input?: SleepRunInput): Promise<SleepRunResult>;
  startSleepSchedule(intervalMs: number): Promise<void>;
  stopSleepSchedule(): Promise<void>;
}

const SLEEP_JOB = 'arcana:sleep-pipeline';

export function createMaintain(deps: MaintainDeps, configOverride?: Partial<SleepConfig>): MaintainApi {
  const config: SleepConfig = { ...DEFAULT_CONFIG, ...configOverride };

  // v1.2.0 — checkpoint map carries ternary state: undefined (not started),
  // 'partial' (ran with errors[] — resume retries), 'complete' (clean success).
  const checkpoints = new Map<SleepStep, 'partial' | 'complete'>();

  // v1.2.0 — single-flight guard: scheduler tick and manual invocation share
  // the same in-flight promise instead of racing checkpoint state.
  let running: Promise<SleepRunResult> | null = null;

  type StepResult = { count: number; processed?: number; errors?: string[] };

  const api: MaintainApi = {
    async runSleepPipeline(input: SleepRunInput = {}): Promise<SleepRunResult> {
      if (running) return running;

      running = (async (): Promise<SleepRunResult> => {
        const startedAt = new Date().toISOString();
        const stepsToRun = input.steps ?? [...SLEEP_STEPS];

        // Resume: skip steps already marked 'complete'. 'partial' steps are
        // re-attempted so the errors[] population can be re-processed.
        const pending = input.resume
          ? stepsToRun.filter((s) => checkpoints.get(s) !== 'complete')
          : stepsToRun;

        if (!input.resume) checkpoints.clear();

        const stepsRun: SleepStep[] = [];
        const partialSteps: SleepStep[] = [];
        let candidatesProcessed = 0;

        for (const step of pending) {
          try {
            let result: StepResult = { count: 0 };

            if (step === 'decayMemories')       result = await runDecayMemories(deps, config);
            else if (step === 'refreshTags')    result = await runRefreshTags(deps, config);
            else if (step === 'consolidateMemories') result = await runConsolidateMemories(deps, config);
            else if (step === 'linkMemories')   result = await runLinkMemories(deps, config);
            else if (step === 'tierMemories')   result = await runTierMemories(deps, config);
            else if (step === 'summarizeMemories') result = await runSummarizeMemories(deps, config);
            else if (step === 'observeConversations') result = await runObserveConversations(deps, config);
            else if (step === 'rebuildUserProfile') result = await runRebuildUserProfile(deps, config);
            else if (step === 'runReasoning')   result = await runReasoning(deps, config);
            else if (step === 'cleanEntityGraph') result = await runCleanEntityGraph(deps, config);

            const hasErrors = (result.errors?.length ?? 0) > 0;
            checkpoints.set(step, hasErrors ? 'partial' : 'complete');
            stepsRun.push(step);
            if (hasErrors) partialSteps.push(step);
            candidatesProcessed += result.processed ?? result.count;
          } catch (err) {
            deps.logger.warn(`sleep step ${step} failed`, { error: String(err) });
            // Hard exception: do NOT checkpoint — will retry on resume.
          }
        }

        return {
          startedAt,
          finishedAt: new Date().toISOString(),
          stepsRun,
          candidatesProcessed,
          partialSteps,
        };
      })();

      try {
        return await running;
      } finally {
        running = null;
      }
    },

    async startSleepSchedule(intervalMs: number): Promise<void> {
      await deps.scheduler.schedule(SLEEP_JOB, intervalMs, async () => {
        await api.runSleepPipeline();
      });
    },

    async stopSleepSchedule(): Promise<void> {
      await deps.scheduler.cancel(SLEEP_JOB);
    },
  };
  return api;
}
