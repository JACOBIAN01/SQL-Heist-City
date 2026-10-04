import type { BenchResult } from './HeadlessBench';

const ms = (v: number) => v.toFixed(2);

/** One-line-per-run table for the console and docs/performance.md. */
export function formatBench(results: readonly BenchResult[]): string {
  const rows = [
    '| players | tick mean | p50 | p95 | p99 | max | KB/s per client | heap KB/tick |',
    '|---|---|---|---|---|---|---|---|',
    ...results.map(
      (r) =>
        `| ${r.players} | ${ms(r.tickMs.mean)} ms | ${ms(r.tickMs.p50)} | ${ms(r.tickMs.p95)} | ${ms(r.tickMs.p99)} | ${ms(r.tickMs.max)} | ${(r.bytesPerClientPerSec / 1024).toFixed(1)} | ${(r.heapBytesPerTick / 1024).toFixed(0)} |`,
    ),
  ];
  return rows.join('\n');
}
