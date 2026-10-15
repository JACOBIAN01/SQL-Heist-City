import { afterAll, describe, expect, it } from 'vitest';
import type { GeneratedTables } from '../variants/dataGenerators';
import type { SandboxJob } from './SandboxRunner';
import { WorkerSandboxRunner } from './WorkerSandboxRunner';

const data = {
  schemaSql: 'CREATE TABLE t (x INTEGER)',
  tables: new Map([['t', { columns: ['x'], rows: [[1], [2], [3]] }]]) as GeneratedTables,
};
const job = (...sql: string[]): SandboxJob => ({ data, queries: sql.map((s) => ({ sql: s })) });

const INFINITE =
  'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT COUNT(*) FROM n';

const runner = new WorkerSandboxRunner({ size: 2, timeoutMs: 500 });
afterAll(() => runner.close());

describe('WorkerSandboxRunner', () => {
  it('runs several queries against one database', async () => {
    const outcome = await runner.run(job('SELECT SUM(x) FROM t', 'SELECT nope'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.outcomes[0]).toMatchObject({ ok: true, result: { rows: [[6]] } });
    expect(outcome.outcomes[1]).toMatchObject({ ok: false, code: 'sql_error' });
  });

  it('kills an infinite recursive CTE at the timeout', async () => {
    const started = Date.now();
    const outcome = await runner.run(job(INFINITE));
    expect(outcome).toMatchObject({ ok: false, code: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('keeps serving after a worker was killed', async () => {
    await runner.run(job(INFINITE));
    const outcome = await runner.run(job('SELECT COUNT(*) FROM t'));
    expect(outcome).toMatchObject({ ok: true, outcomes: [{ ok: true, result: { rows: [[3]] } }] });
  });

  it('a stuck job does not block other jobs', async () => {
    const stuck = runner.run(job(INFINITE));
    const quick = await runner.run(job('SELECT 42'));
    expect(quick).toMatchObject({ ok: true, outcomes: [{ result: { rows: [[42]] } }] });
    await stuck;
  });

  it('queues more jobs than workers', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, (_, i) => runner.run(job(`SELECT ${i}`))),
    );
    expect(
      outcomes.map((o) => (o.ok && o.outcomes[0]?.ok ? o.outcomes[0].result.rows[0]?.[0] : null)),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('reports a broken question schema as a setup error', async () => {
    const outcome = await runner.run({
      data: { ...data, schemaSql: 'CREATE NONSENSE' },
      queries: [],
    });
    expect(outcome).toMatchObject({ ok: false, code: 'setup' });
  });
});

describe('WorkerSandboxRunner: lanes (19.3)', () => {
  const lanes = new WorkerSandboxRunner({ size: 2, timeoutMs: 5_000, fastBudgetMs: 30 });
  afterAll(() => lanes.close());

  it('moves a runaway aside, so ordinary jobs are not held up behind it', async () => {
    const stuck = lanes.run(job(INFINITE));
    const stuck2 = lanes.run(job(INFINITE));
    await new Promise((r) => setTimeout(r, 300)); // both overran their first budget by now
    const started = Date.now();
    const quick = await lanes.run(job('SELECT 7'));
    expect(quick).toMatchObject({ ok: true, outcomes: [{ result: { rows: [[7]] } }] });
    // One of the two slots stays free for ordinary work while the runaways wait their turn.
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(lanes.stats().demoted).toBeGreaterThanOrEqual(2);
    void stuck;
    void stuck2;
  }, 20_000);

  it('a slow but finite job still completes after being moved to the slow lane', async () => {
    const outcome = await lanes.run(
      job(
        'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 400000) SELECT COUNT(*) FROM n',
      ),
    );
    expect(outcome).toMatchObject({
      ok: true,
      outcomes: [{ ok: true, result: { rows: [[400000]] } }],
    });
  }, 30_000);
});
