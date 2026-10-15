import { tmpdir } from 'node:os';
import { fuzzCases, fuzzSandbox } from '../sql/fuzz/SqlFuzzer';
import { WorkerSandboxRunner } from '../sql/WorkerSandboxRunner';

/**
 * SQL sandbox fuzzer (Phase 18.4): hostile and oversized queries against the real worker sandbox.
 *   npm run fuzz:sql -w @heist/server -- --iterations 5000 --seed nightly-2026-10-15
 * Exits 1 on any escape, crash or hang. Runs nightly in CI.
 */
const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const iterations = Number(arg('iterations', '1000'));
const seed = arg('seed', `fuzz-${new Date().toISOString().slice(0, 10)}`);
const timeoutMs = Number(arg('timeout', '1000'));

const runner = new WorkerSandboxRunner({ timeoutMs });
const started = Date.now();
const report = await fuzzSandbox(runner, fuzzCases(seed, iterations), {
  dirs: [process.cwd(), tmpdir()],
  timeoutMs,
});
await runner.close();
console.log(
  `seed ${seed}: ${report.cases} cases ${JSON.stringify(report.byFamily)}, ${report.timeouts} stopped by the time limit, ` +
    `${report.failures.length} failures — ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
for (const f of report.failures.slice(0, 20))
  console.log(`✗ ${f.reason}: [${f.case.family}/${f.case.mode}] ${f.case.sql.slice(0, 200)}`);
process.exit(report.failures.length > 0 ? 1 : 0);
