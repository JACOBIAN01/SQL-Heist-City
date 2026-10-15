import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

/**
 * Capacity per core (Phase 19.4): runs several class matches at once, each on its own thread as
 * class rooms do, and reports what one match costs and how many fit on a core.
 *   npm run capacity -w @heist/server -- --matches 1,4,7 --players 100 --seconds 15
 */
const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const counts = arg('matches', `1,${Math.max(1, availableParallelism() - 1)}`)
  .split(',')
  .map(Number);
const players = Number(arg('players', '100'));
const seconds = Number(arg('seconds', '15'));
/** Share of a core a match may use and still leave headroom for sockets, grading and spikes. */
const UTILISATION = 0.5;
const TICK_HZ = 20;

console.log(
  `| matches at once | players each | tick mean | p99 | CPU ms per second per match | matches per core at ${UTILISATION * 100}% |`,
);
console.log('|---|---|---|---|---|---|---|');
for (const n of counts) {
  const results = await Promise.all(
    Array.from(
      { length: n },
      (_, i) =>
        new Promise<{ tickMs: { mean: number; p99: number }; rss: number }>((resolve, reject) => {
          const w = new Worker(new URL('./capacityWorker.ts', import.meta.url), {
            execArgv: ['--import', 'tsx'],
            workerData: { players, seconds, seed: `cap-${i}` },
          });
          w.once('message', resolve);
          w.once('error', reject);
        }),
    ),
  );
  const mean = results.reduce((s, r) => s + r.tickMs.mean, 0) / n;
  const p99 = Math.max(...results.map((r) => r.tickMs.p99));
  const perSecond = mean * TICK_HZ;
  console.log(
    `| ${n} | ${players} | ${mean.toFixed(2)} ms | ${p99.toFixed(2)} ms | ${perSecond.toFixed(0)} | ${Math.floor((1000 * UTILISATION) / perSecond)} | ${Math.round(Math.max(...results.map((r) => r.rss)) / 1e6)} MB |`,
  );
}
process.exit(0);
