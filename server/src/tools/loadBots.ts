import { TEST_MAP } from '@heist/shared';
import { makeBenchMap } from '../loadtest/benchMap';
import { formatBench } from '../loadtest/format';
import { runHeadlessBench } from '../loadtest/HeadlessBench';
import { runSocketBots } from '../loadtest/SocketBots';

/**
 * Load harness.
 *   npm run load:bots -- --players 100 [--seconds 20] [--fire 0.2]
 *       in-process: server cost per tick with N scripted bots (no network)
 *   npm run load:bots -- --mode socket --players 50 [--url ws://localhost:8080/ws/game]
 *       real WebSocket clients against a running server
 * Add --map sandbox to use the small test yard instead of the city-sized bench map.
 * Several sizes at once: --players 60,100,200
 */
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.replace(/^--/, '');
  const value = process.argv[i + 1];
  if (key && value !== undefined) args.set(key, value);
}
const sizes = (args.get('players') ?? '100').split(',').map(Number);
const seconds = Number(args.get('seconds') ?? 20);
const fireRate = Number(args.get('fire') ?? 0.1);
const mode = args.get('mode') ?? 'headless';

if (mode === 'socket') {
  const url = args.get('url') ?? 'ws://localhost:8080/ws/game';
  for (const players of sizes) {
    console.log(`connecting ${players} bots to ${url} for ${seconds}s…`);
    const r = await runSocketBots({ url, players, seconds, fireRate });
    console.log(
      `joined ${r.joined}, failed ${r.failed}, rtt p50 ${r.rttMs.p50.toFixed(1)} ms p95 ${r.rttMs.p95.toFixed(1)} ms, ` +
        `${(r.bytesPerClientPerSec / 1024).toFixed(1)} KB/s per client, ${r.snapshotsPerClientPerSec.toFixed(1)} snapshots/s`,
    );
  }
} else {
  const map = args.get('map') === 'sandbox' ? TEST_MAP : makeBenchMap();
  const results = sizes.map((players) => runHeadlessBench({ players, map, seconds, fireRate }));
  console.log(formatBench(results));
}
process.exit(0);
