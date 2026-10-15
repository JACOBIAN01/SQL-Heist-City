import { runSoak } from '../loadtest/Soak';

/**
 * Soak and reconnect chaos (Phase 19.5):
 *   npm run soak -w @heist/server -- --players 100 --hours 4 --churn 0.05
 * Ticks run back to back, so 4 hours of game time take minutes. Run with `node --expose-gc` (the
 * script does) so heap samples are taken after a collection. Exits 1 on lost progress or a heap
 * that grew more than --leak-mb after warm-up.
 */
const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const players = Number(arg('players', '100'));
const hours = Number(arg('hours', '4'));
const churn = Number(arg('churn', '0.05'));
const leakMb = Number(arg('leak-mb', '20'));
const started = Date.now();
const report = runSoak({
  players,
  gameMinutes: Math.round(hours * 60),
  churn,
  onSample: (minute, heap) => {
    if (minute % 30 === 0) console.log(`  ${minute} min: heap ${heap.toFixed(1)} MB`);
  },
});
const growth = report.heapEndMb - report.heapStartMb;
console.log(
  `${hours} h of game time with ${players} bots in ${((Date.now() - started) / 1000).toFixed(0)} s: ` +
    `${report.ticks} ticks, ${report.rounds} rounds, ${report.drops} drops, ${report.rejoins} rejoins, ` +
    `${report.lostProgress.length} lost progress; heap ${report.heapStartMb.toFixed(1)} → ${report.heapEndMb.toFixed(1)} MB`,
);
for (const l of report.lostProgress.slice(0, 10)) console.log(`✗ ${l}`);
process.exit(report.lostProgress.length > 0 || growth > leakMb ? 1 : 0);
