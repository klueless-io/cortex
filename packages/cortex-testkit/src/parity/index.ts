/**
 * Parity harness — generic top-N overlap test for swapping a working
 * parallel implementation to a kernel implementation.
 *
 * Spec: docs/decisions/009-parity-gate-for-consumer-swaps.md §"Future
 * evolution" — "Shared harness in cortex-testkit: factor out the
 * comparison logic so consumers only supply fixtures + the two
 * implementations under test."
 *
 * Shape: caller seeds any fixtures into their stores themselves, then
 * passes a query corpus + two functions (`baseline`, `candidate`) + an
 * `extractIds` mapping. Harness runs every query through both, computes
 * top-N overlap per query, and aggregates a pass/fail report.
 *
 * Threshold default 0.8 (top-10 must share ≥ 8 ids) — per ADR 009.
 *
 * Use it from a consumer test file:
 *
 *   const report = await runParityHarness({
 *     queries: [{ id: 'q1', input: { query: 'kybernesis' } }],
 *     baseline:  (input) => legacyHybridSearch(input as Query),
 *     candidate: (input) => cortex.retrieve.hybridSearch(input as Query),
 *     extractIds: (r) => r.data.map((row) => row.memory.id),
 *   });
 *   expect(report.passes).toBe(true);
 */

export interface ParityQuery {
  /** Stable identifier for this query — used in the report. */
  id: string;
  /** Whatever shape the consumer's baseline/candidate accept. */
  input: unknown;
}

export interface ParityHarnessInput<TResult, TId = string> {
  queries: ParityQuery[];
  baseline: (input: unknown) => Promise<TResult>;
  candidate: (input: unknown) => Promise<TResult>;
  /**
   * Extract the comparable identity list from a single query result.
   * Order matters only insofar as the first `topN` ids are compared.
   */
  extractIds: (result: TResult) => TId[];
  /** Top-N depth to compare. Default 10. */
  topN?: number;
  /** Minimum mean overlap (0..1) to pass. Default 0.8. */
  threshold?: number;
}

export interface ParityPerQueryReport<TId = string> {
  queryId: string;
  /** Fraction of baseline's top-N that also appears in candidate's top-N. */
  overlap: number;
  baselineIds: TId[];
  candidateIds: TId[];
  missingFromCandidate: TId[];
  extraInCandidate: TId[];
  error?: { side: 'baseline' | 'candidate'; message: string };
}

export interface ParityReport<TId = string> {
  passes: boolean;
  threshold: number;
  topN: number;
  meanOverlap: number;
  totalQueries: number;
  perQuery: ParityPerQueryReport<TId>[];
}

const DEFAULT_TOP_N = 10;
const DEFAULT_THRESHOLD = 0.8;

/**
 * Run the parity harness. Each query runs through both functions; failures
 * on either side are captured per-query rather than aborting the run. A
 * query that errors on either side contributes `overlap: 0` to the mean.
 *
 * Empty corpus returns `meanOverlap: 0` and `passes: false` — parity
 * cannot be proven with zero evidence.
 */
export async function runParityHarness<TResult, TId = string>(
  input: ParityHarnessInput<TResult, TId>,
): Promise<ParityReport<TId>> {
  const topN = input.topN ?? DEFAULT_TOP_N;
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;
  const perQuery: ParityPerQueryReport<TId>[] = [];

  for (const q of input.queries) {
    let baselineResult: TResult | undefined;
    let candidateResult: TResult | undefined;
    let error: ParityPerQueryReport<TId>['error'];

    try {
      baselineResult = await input.baseline(q.input);
    } catch (err) {
      error = { side: 'baseline', message: (err as Error).message };
    }

    if (!error) {
      try {
        candidateResult = await input.candidate(q.input);
      } catch (err) {
        error = { side: 'candidate', message: (err as Error).message };
      }
    }

    if (error || baselineResult === undefined || candidateResult === undefined) {
      perQuery.push({
        queryId: q.id,
        overlap: 0,
        baselineIds: [],
        candidateIds: [],
        missingFromCandidate: [],
        extraInCandidate: [],
        error,
      });
      continue;
    }

    const baselineIds = input.extractIds(baselineResult).slice(0, topN);
    const candidateIds = input.extractIds(candidateResult).slice(0, topN);
    const candidateSet = new Set(candidateIds);
    const baselineSet = new Set(baselineIds);

    const overlap =
      baselineIds.length === 0
        ? 0
        : baselineIds.filter((id) => candidateSet.has(id)).length / baselineIds.length;

    const missingFromCandidate = baselineIds.filter((id) => !candidateSet.has(id));
    const extraInCandidate = candidateIds.filter((id) => !baselineSet.has(id));

    perQuery.push({
      queryId: q.id,
      overlap,
      baselineIds,
      candidateIds,
      missingFromCandidate,
      extraInCandidate,
    });
  }

  const meanOverlap =
    perQuery.length === 0
      ? 0
      : perQuery.reduce((sum, q) => sum + q.overlap, 0) / perQuery.length;

  return {
    passes: perQuery.length > 0 && meanOverlap >= threshold,
    threshold,
    topN,
    meanOverlap,
    totalQueries: perQuery.length,
    perQuery,
  };
}
