import {
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  SIM_DT,
  SeededRng,
  seedOf,
  type GameMap,
  type InputCommand,
  type MatchSettings,
} from '@heist/shared';
import { Match } from '../game/Match';
import type { PlayerConnection } from '../game/Player';
import { WanderBrain, type BotBrain } from './BotBrain';
import { summarise, type Summary } from './percentiles';

/** A connection that only counts what the server tries to send. */
export class CountingConnection implements PlayerConnection {
  bytes = 0;
  messages = 0;
  send(bytes: Uint8Array): void {
    this.bytes += bytes.length;
    this.messages++;
  }
  close(): void {}
}

export interface BenchOptions {
  readonly players: number;
  readonly map: GameMap;
  /** Simulated seconds to run (after warm-up). */
  readonly seconds: number;
  readonly warmupSeconds?: number;
  readonly seed?: string;
  /** Fraction of bots that hold the trigger at any moment. */
  readonly fireRate?: number;
  readonly settings?: Partial<MatchSettings>;
}

export interface BenchResult {
  readonly players: number;
  readonly ticks: number;
  /** Time spent inside `Match.step()` per tick, ms. */
  readonly tickMs: Summary;
  /** Average bytes the server sends to one client per second. */
  readonly bytesPerClientPerSec: number;
  /**
   * Heap growth per `Match.step()`, KB (sum of positive heap deltas; a tick where
   * the heap shrank had a collection and is counted in `gcTicks` instead). A rough
   * measure of garbage produced per tick: pooled code should be near zero.
   */
  readonly allocKbPerTick: number;
  /** Ticks during which the garbage collector ran. */
  readonly gcTicks: number;
}

/**
 * Runs a whole match in-process with scripted bots and measures the server's
 * per-tick cost without any network noise. This is the number that has to stay
 * under 15 ms at 100 players (docs/backend.md).
 */
export function runHeadlessBench(options: BenchOptions): BenchResult {
  const settings: MatchSettings = {
    ...DEFAULT_MATCH_SETTINGS,
    maxPlayers: Math.max(options.players, 1),
    sandboxDummies: 0,
    ...options.settings,
  };
  const match = new Match({ map: options.map, settings, seed: options.seed ?? 'bench' });
  const connections: CountingConnection[] = [];
  const brains: BotBrain[] = [];
  const ids: number[] = [];
  const seqs: number[] = [];
  const seed = options.seed ?? 'bench';

  for (let i = 0; i < options.players; i++) {
    const connection = new CountingConnection();
    const joined = match.join(PROTOCOL_VERSION, `bot-${i}`, connection);
    if (!joined.ok) throw new Error(`bot ${i} could not join: ${joined.reason}`);
    // Bots start unprotected so combat load is realistic from the first tick.
    joined.player.protectedUntilTick = 0;
    connections.push(connection);
    ids.push(joined.player.id);
    seqs.push(0);
    brains.push(
      new WanderBrain(new SeededRng(seedOf(seed, 'bot', i)), { fireRate: options.fireRate ?? 0 }),
    );
  }

  const commandsPerTick = Math.round(1 / settings.tickRate / SIM_DT);
  const feed = () => {
    for (let b = 0; b < ids.length; b++) {
      const batch: InputCommand[] = [];
      for (let c = 0; c < commandsPerTick; c++) {
        seqs[b] = ((seqs[b] ?? 0) + 1) & 0xffff;
        batch.push({ seq: seqs[b] ?? 0, ...(brains[b] as BotBrain).next() });
      }
      match.receiveInput(ids[b] as number, batch);
    }
  };

  const warmup = Math.round((options.warmupSeconds ?? 2) * settings.tickRate);
  for (let t = 0; t < warmup; t++) {
    feed();
    match.step();
  }
  for (const c of connections) c.bytes = 0;

  const ticks = Math.round(options.seconds * settings.tickRate);
  const durations: number[] = [];
  let allocated = 0;
  let gcTicks = 0;
  for (let t = 0; t < ticks; t++) {
    feed();
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    match.step();
    durations.push(performance.now() - started);
    const heapAfter = process.memoryUsage().heapUsed;
    if (heapAfter >= heapBefore) allocated += heapAfter - heapBefore;
    else gcTicks++;
  }

  const totalBytes = connections.reduce((s, c) => s + c.bytes, 0);
  return {
    players: options.players,
    ticks,
    tickMs: summarise(durations),
    bytesPerClientPerSec: totalBytes / Math.max(1, options.players) / options.seconds,
    allocKbPerTick: allocated / ticks / 1024,
    gcTicks,
  };
}
