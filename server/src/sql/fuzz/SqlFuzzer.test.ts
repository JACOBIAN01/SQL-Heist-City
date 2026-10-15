import { afterAll, describe, expect, it } from 'vitest';
import { WorkerSandboxRunner } from '../WorkerSandboxRunner';
import { fuzzCases, fuzzSandbox } from './SqlFuzzer';

const runner = new WorkerSandboxRunner({ size: 2, timeoutMs: 400 });
afterAll(() => runner.close());

describe('SQL sandbox fuzzing (18.4)', () => {
  it('builds the same cases from the same seed, covering every family', () => {
    const a = [...fuzzCases('s', 200)];
    expect([...fuzzCases('s', 200)]).toEqual(a);
    expect(new Set(a.map((c) => c.family))).toEqual(
      new Set(['escape', 'write', 'bomb', 'oversized', 'garbage', 'mutation']),
    );
  });

  it('nothing escapes, writes stay in write tasks, and every job ends', async () => {
    const report = await fuzzSandbox(runner, fuzzCases('ci', 60), { timeoutMs: 400 });
    expect(report.failures).toEqual([]);
    expect(report.cases).toBe(60);
  }, 60_000);

  it('notices an escape (a runner that lets everything through fails)', async () => {
    const leaky = {
      run: async () => ({
        ok: true as const,
        outcomes: [
          { ok: true as const, result: { columns: ['x'], rows: [[1]], truncated: false } },
          {
            ok: true as const,
            result: { columns: ['x'], rows: [[1], [2], [3]], truncated: false },
          },
        ],
      }),
      close: async () => {},
    };
    const report = await fuzzSandbox(leaky, fuzzCases('leak', 30));
    expect(report.failures.length).toBeGreaterThan(0);
    expect(report.failures.map((f) => f.reason)).toContain('an escape statement succeeded');
  });
});
