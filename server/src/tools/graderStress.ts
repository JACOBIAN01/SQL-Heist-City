import { availableParallelism } from 'node:os';
import { questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { Grader } from '../sql/Grader';
import { WorkerSandboxRunner } from '../sql/WorkerSandboxRunner';
import { builtInDatasets } from '../variants/datasets';
import { VariantBuilder } from '../variants/VariantBuilder';

/**
 * Grader stress (Phase 19.2): many players submit at the same moment, some with queries that run
 * until the time limit kills them. Reports how long ordinary answers waited and took.
 *   npm run grader:stress -w @heist/server -- --submits 100 --heavy 0.2 [--slots 4] [--timeout 2000]
 */
const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const submits = Number(arg('submits', '100'));
const heavyShare = Number(arg('heavy', '0.2'));
const slots = Number(arg('slots', String(Math.max(1, availableParallelism() - 1))));
const timeoutMs = Number(arg('timeout', '2000'));
const fastBudgetMs = Number(arg('budget', '150'));
/** `first`: every heavy query arrives before the rest (the worst case); `mixed`: spread through. */
const order = arg('order', 'mixed');

const HEAVY =
  'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT COUNT(*) FROM n';
const runner = new WorkerSandboxRunner({ size: slots, timeoutMs, fastBudgetMs });
const grader = new Grader(runner);
const template = questionTemplateSchema.parse(sampleQuestion);
const variants = new VariantBuilder(builtInDatasets);

// Warm every slot, so start-up is not counted.
await Promise.all(
  Array.from({ length: slots }, () =>
    runner.run({ data: { schemaSql: 'SELECT 1', tables: new Map() }, queries: [] }),
  ),
);

const prepared = await Promise.all(
  Array.from({ length: submits }, async (_, i) => {
    const variant = variants.build(template, `stress-${i}`);
    return {
      variant,
      expected: await grader.expectedResult(variant),
      heavy: i < submits * heavyShare,
    };
  }),
);
const before = runner.stats();
const started = Date.now();
const results = await Promise.all(
  prepared.map(async ({ variant, expected, heavy }) => {
    const t = Date.now();
    const g = await grader.grade(variant, expected, heavy ? HEAVY : variant.referenceSql);
    return { heavy, ms: Date.now() - t, status: g.status };
  }),
);
const total = Date.now() - started;
const stats = runner.stats();
await runner.close();

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
};
const normal = results.filter((r) => !r.heavy);
console.log(
  `${submits} simultaneous submits (${results.length - normal.length} heavy, ${order}) on ${slots} sandbox processes, ${timeoutMs} ms limit, ${fastBudgetMs} ms first budget: all done in ${total} ms`,
);
console.log(
  `ordinary answers: p50 ${pct(
    normal.map((r) => r.ms),
    0.5,
  )} ms, p95 ${pct(
    normal.map((r) => r.ms),
    0.95,
  )} ms, ` +
    `${normal.filter((r) => r.status === 'correct').length}/${normal.length} graded correct`,
);
console.log(
  `queue wait (all jobs this run): p95 ${stats.waitMs.p95} ms, max ${stats.waitMs.max} ms; timeouts ${stats.timeouts - before.timeouts}`,
);
