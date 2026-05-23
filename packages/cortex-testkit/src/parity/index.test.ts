import { describe, it, expect } from 'vitest';
import { runParityHarness } from './index.js';

/** Fixture: deterministic faux retrieval. */
function fakeRetrieval(ids: string[]) {
  return async () => ({ data: ids });
}

const extractIds = (r: { data: string[] }) => r.data;

describe('runParityHarness', () => {
  it('passes when overlap meets the default 0.8 threshold', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const report = await runParityHarness({
      queries: [{ id: 'q1', input: null }],
      baseline: fakeRetrieval(ids),
      candidate: fakeRetrieval(ids),
      extractIds,
    });
    expect(report.passes).toBe(true);
    expect(report.meanOverlap).toBe(1);
    expect(report.totalQueries).toBe(1);
    expect(report.threshold).toBe(0.8);
    expect(report.topN).toBe(10);
  });

  it('fails when baseline and candidate share no ids', async () => {
    const report = await runParityHarness({
      queries: [{ id: 'q1', input: null }],
      baseline: fakeRetrieval(['a', 'b', 'c']),
      candidate: fakeRetrieval(['x', 'y', 'z']),
      extractIds,
    });
    expect(report.passes).toBe(false);
    expect(report.meanOverlap).toBe(0);
  });

  it('exactly at threshold passes; just below fails', async () => {
    const baselineIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    // 8 of 10 = 0.8 — exact threshold
    const atThreshold = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'X', 'Y'];
    const passReport = await runParityHarness({
      queries: [{ id: 'q1', input: null }],
      baseline: fakeRetrieval(baselineIds),
      candidate: fakeRetrieval(atThreshold),
      extractIds,
    });
    expect(passReport.passes).toBe(true);
    expect(passReport.meanOverlap).toBe(0.8);

    // 7 of 10 = 0.7 — below threshold
    const belowThreshold = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'X', 'Y', 'Z'];
    const failReport = await runParityHarness({
      queries: [{ id: 'q1', input: null }],
      baseline: fakeRetrieval(baselineIds),
      candidate: fakeRetrieval(belowThreshold),
      extractIds,
    });
    expect(failReport.passes).toBe(false);
    expect(failReport.meanOverlap).toBeCloseTo(0.7);
  });

  it('reports per-query missingFromCandidate and extraInCandidate', async () => {
    const report = await runParityHarness({
      queries: [{ id: 'q1', input: null }],
      baseline: fakeRetrieval(['a', 'b', 'c']),
      candidate: fakeRetrieval(['b', 'c', 'd']),
      extractIds,
    });
    const q = report.perQuery[0]!;
    expect(q.queryId).toBe('q1');
    expect(q.missingFromCandidate).toEqual(['a']);
    expect(q.extraInCandidate).toEqual(['d']);
    expect(q.overlap).toBeCloseTo(2 / 3);
  });

  it('captures baseline errors per-query with side="baseline"', async () => {
    const report = await runParityHarness({
      queries: [{ id: 'q1', input: null }],
      baseline: async () => { throw new Error('baseline boom'); },
      candidate: fakeRetrieval(['a', 'b']),
      extractIds,
    });
    expect(report.passes).toBe(false);
    expect(report.perQuery[0]?.error?.side).toBe('baseline');
    expect(report.perQuery[0]?.error?.message).toBe('baseline boom');
    expect(report.perQuery[0]?.overlap).toBe(0);
  });

  it('captures candidate errors per-query with side="candidate"', async () => {
    const report = await runParityHarness({
      queries: [{ id: 'q1', input: null }],
      baseline: fakeRetrieval(['a', 'b']),
      candidate: async () => { throw new Error('candidate boom'); },
      extractIds,
    });
    expect(report.perQuery[0]?.error?.side).toBe('candidate');
    expect(report.perQuery[0]?.error?.message).toBe('candidate boom');
    expect(report.perQuery[0]?.overlap).toBe(0);
  });

  it('empty corpus returns meanOverlap 0 and passes false', async () => {
    const report = await runParityHarness({
      queries: [],
      baseline: fakeRetrieval(['a']),
      candidate: fakeRetrieval(['a']),
      extractIds,
    });
    expect(report.totalQueries).toBe(0);
    expect(report.meanOverlap).toBe(0);
    expect(report.passes).toBe(false);
  });

  it('honors custom threshold below default', async () => {
    const report = await runParityHarness({
      queries: [{ id: 'q1', input: null }],
      baseline: fakeRetrieval(['a', 'b', 'c', 'd', 'e']),
      candidate: fakeRetrieval(['a', 'b', 'c', 'X', 'Y']),
      extractIds,
      threshold: 0.5,
    });
    expect(report.meanOverlap).toBeCloseTo(0.6);
    expect(report.passes).toBe(true);
    expect(report.threshold).toBe(0.5);
  });

  it('honors custom topN — ignores results beyond topN', async () => {
    // Baseline returns 5 items; candidate matches only the first 2; rest differ.
    // With topN=2, overlap = 2/2 = 1.0. With default topN=10, overlap = 2/5 = 0.4.
    const report = await runParityHarness({
      queries: [{ id: 'q1', input: null }],
      baseline: fakeRetrieval(['a', 'b', 'c', 'd', 'e']),
      candidate: fakeRetrieval(['a', 'b', 'X', 'Y', 'Z']),
      extractIds,
      topN: 2,
    });
    expect(report.topN).toBe(2);
    expect(report.meanOverlap).toBe(1);
    expect(report.perQuery[0]?.baselineIds).toEqual(['a', 'b']);
    expect(report.perQuery[0]?.candidateIds).toEqual(['a', 'b']);
  });

  it('extractIds returning empty array yields 0 overlap for that query', async () => {
    const report = await runParityHarness({
      queries: [{ id: 'q1', input: null }],
      baseline: fakeRetrieval([]),
      candidate: fakeRetrieval(['a', 'b']),
      extractIds,
    });
    expect(report.perQuery[0]?.overlap).toBe(0);
  });

  it('averages overlap across multiple queries', async () => {
    const report = await runParityHarness({
      queries: [
        { id: 'q1', input: 'first' },
        { id: 'q2', input: 'second' },
      ],
      baseline: async (input) =>
        input === 'first' ? { data: ['a', 'b'] } : { data: ['c', 'd'] },
      candidate: async (input) =>
        input === 'first' ? { data: ['a', 'b'] } : { data: ['X', 'Y'] },
      extractIds,
    });
    expect(report.totalQueries).toBe(2);
    expect(report.meanOverlap).toBe(0.5); // (1.0 + 0.0) / 2
    expect(report.passes).toBe(false); // 0.5 < default 0.8
  });
});
