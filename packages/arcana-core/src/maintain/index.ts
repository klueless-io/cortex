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

  // In-memory checkpoint map for the current run (step name → completed)
  const checkpoints = new Map<SleepStep, boolean>();

  const api: MaintainApi = {
    async runSleepPipeline(input: SleepRunInput = {}): Promise<SleepRunResult> {
      const startedAt = new Date().toISOString();
      const stepsToRun = input.steps ?? [...SLEEP_STEPS];

      // Resume: skip already-completed steps
      const pending = input.resume
        ? stepsToRun.filter((s) => !checkpoints.get(s))
        : stepsToRun;

      if (!input.resume) checkpoints.clear();

      const stepsRun: SleepStep[] = [];
      let candidatesProcessed = 0;

      for (const step of pending) {
        try {
          let result: { count: number; processed?: number } = { count: 0 };

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

          checkpoints.set(step, true);
          stepsRun.push(step);
          candidatesProcessed += result.processed ?? result.count;
        } catch (err) {
          deps.logger.warn(`sleep step ${step} failed`, { error: String(err) });
          // Continue to next step — each step is idempotent and resumable
        }
      }

      return {
        startedAt,
        finishedAt: new Date().toISOString(),
        stepsRun,
        candidatesProcessed,
      };
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
