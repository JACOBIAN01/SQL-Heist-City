import type { Server } from 'node:http';
import { DEFAULT_MATCH_SETTINGS, TEST_MAP, type GameMap, type MatchSettings } from '@heist/shared';
import { GameLoop } from './GameLoop';
import { attachGameSocket, type GameSocket } from './GameSocket';
import { Match } from './Match';
import { RateMeter } from './RateMeter';

export interface GameMetrics {
  readonly players: number;
  readonly tick: number;
  /** Time `Match.step()` takes (ms), over the last ~200 ticks. */
  readonly tickMs: {
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
    readonly max: number;
  };
  readonly bytesPerSecond: number;
  readonly snapshotsPerSecond: number;
  /** Average bytes sent per player per second. */
  readonly bytesPerPlayerPerSecond: number;
}

export interface RunningGame {
  readonly match: Match;
  metrics(): GameMetrics;
  readonly loop: GameLoop;
  stop(): Promise<void>;
}

/** Wires one match to the HTTP server and starts ticking. Composition only, no rules. */
export function startGame(
  http: Server,
  settings: MatchSettings = DEFAULT_MATCH_SETTINGS,
  map: GameMap = TEST_MAP,
): RunningGame {
  const match = new Match({ map, settings });
  (map.dummies ?? [])
    .slice(0, settings.sandboxDummies)
    .forEach((spot, i) => match.addDummy(`Dummy ${i + 1}`, spot));
  const loop = new GameLoop(1000 / settings.tickRate, () => match.step());
  const socket: GameSocket = attachGameSocket(http, match);
  const bytes = new RateMeter();
  const snapshots = new RateMeter();
  const sampler = setInterval(() => {
    const now = Date.now();
    bytes.mark(match.traffic.bytes, now);
    snapshots.mark(match.traffic.snapshots, now);
  }, 1000);
  sampler.unref();
  loop.start();
  return {
    match,
    loop,
    metrics: () => ({
      players: match.players.size,
      tick: match.tick,
      tickMs: {
        p50: loop.stats.percentile(50),
        p95: loop.stats.percentile(95),
        p99: loop.stats.percentile(99),
        max: loop.stats.max,
      },
      bytesPerSecond: bytes.perSecond,
      snapshotsPerSecond: snapshots.perSecond,
      bytesPerPlayerPerSecond: bytes.perSecond / Math.max(1, match.players.size),
    }),
    async stop() {
      loop.stop();
      clearInterval(sampler);
      await socket.close();
    },
  };
}
