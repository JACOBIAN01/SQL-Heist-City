import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
  SIM_DT,
  SeededRng,
  seedOf,
  type HeistSettings,
  type InputCommand,
} from '@heist/shared';
import { Match } from '../game/Match';
import type { Player } from '../game/Player';
import { WanderBrain } from './BotBrain';
import { CountingConnection } from './HeadlessBench';

export interface SoakOptions {
  readonly players: number;
  /** Game time to simulate (ticks run back to back, so hours take minutes). */
  readonly gameMinutes: number;
  /** Share of signed-in bots that drop and rejoin each game minute. */
  readonly churn: number;
  /** Shorter rounds put the round-reset paths under load too. */
  readonly roundMinutes?: number;
  readonly seed?: string;
  /** Called with heap use (MB, after a collection when `gc` is available) every game minute. */
  readonly onSample?: (minute: number, heapMb: number) => void;
}

export interface SoakReport {
  readonly ticks: number;
  readonly rounds: number;
  readonly drops: number;
  readonly rejoins: number;
  /** Rejoins whose banked cash, score or guns did not come back. */
  readonly lostProgress: readonly string[];
  /** Heap after warm-up, and at the end (MB). */
  readonly heapStartMb: number;
  readonly heapEndMb: number;
  readonly samples: readonly number[];
}

const gc = (globalThis as { gc?: () => void }).gc;
const heapMb = () => {
  gc?.();
  return process.memoryUsage().heapUsed / 1e6;
};

/**
 * The soak and reconnect chaos run (Phase 19.5): a heist match full of wandering, shooting bots
 * for hours of game time, with rounds cycling; every game minute some signed-in bots drop
 * mid-round and come back. Each comeback must get its banked cash, score and guns back, and the
 * heap must not keep growing.
 */
export function runSoak(options: SoakOptions): SoakReport {
  const heist: HeistSettings = {
    ...DEFAULT_HEIST_SETTINGS,
    roundMinutes: options.roundMinutes ?? 3,
    intermissionSeconds: 5,
  };
  const match = new Match({
    map: HEIST_MAP,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: options.players, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist,
    seed: options.seed ?? 'soak',
    now: () => 0, // idle timeouts off: bots never go quiet
  });
  const rng = new SeededRng(options.seed ?? 'soak');
  const bots = new Map<number, { player: Player; brain: WanderBrain; seq: number }>();
  const join = (account: number) => {
    const r = match.join(PROTOCOL_VERSION, `bot-${account}`, new CountingConnection(), account);
    if (!r.ok) return undefined;
    r.player.protectedUntilTick = 0;
    bots.set(account, {
      player: r.player,
      brain: new WanderBrain(new SeededRng(seedOf('soak', account)), { fireRate: 0.1 }),
      seq: 0,
    });
    return r.player;
  };
  for (let a = 1; a <= options.players; a++) join(a);

  const commandsPerTick = Math.round(1 / DEFAULT_MATCH_SETTINGS.tickRate / SIM_DT);
  const ticksPerMinute = DEFAULT_MATCH_SETTINGS.tickRate * 60;
  const lostProgress: string[] = [];
  let drops = 0;
  let rejoins = 0;
  let rounds = 0;
  let lastRound = match.roundNumber;
  const samples: number[] = [];
  let heapStart = 0;

  for (let minute = 1; minute <= options.gameMinutes; minute++) {
    for (let t = 0; t < ticksPerMinute; t++) {
      for (const bot of bots.values()) {
        const batch: InputCommand[] = [];
        for (let c = 0; c < commandsPerTick; c++) {
          bot.seq = (bot.seq + 1) & 0xffff;
          batch.push({ seq: bot.seq, ...bot.brain.next() });
        }
        match.receiveInput(bot.player.id, batch);
      }
      match.step();
      // Some banking now and then, so there is progress to keep.
      if (t % 100 === 0) for (const bot of bots.values()) bot.player.banked += 10;
      if (match.roundNumber !== lastRound) {
        rounds++;
        lastRound = match.roundNumber;
      }
    }
    // Chaos: some signed-in bots drop mid-round and come straight back.
    if (!match.heist.roundOver) {
      for (const [account, bot] of [...bots]) {
        if (!rng.bool(options.churn)) continue;
        const before = {
          banked: bot.player.banked,
          kills: bot.player.kills,
          guns: [...bot.player.arsenal.keys()].sort().join(),
        };
        match.leave(bot.player.id);
        bots.delete(account);
        drops++;
        const back = join(account);
        if (!back) {
          lostProgress.push(`account ${account} could not rejoin`);
          continue;
        }
        rejoins++;
        const after = {
          banked: back.banked,
          kills: back.kills,
          guns: [...back.arsenal.keys()].sort().join(),
        };
        if (JSON.stringify(after) !== JSON.stringify(before))
          lostProgress.push(
            `account ${account}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`,
          );
      }
    }
    const heap = heapMb();
    samples.push(heap);
    if (minute === Math.min(10, options.gameMinutes)) heapStart = heap;
    options.onSample?.(minute, heap);
  }
  return {
    ticks: match.tick,
    rounds,
    drops,
    rejoins,
    lostProgress,
    heapStartMb: heapStart,
    heapEndMb: samples.at(-1) ?? 0,
    samples,
  };
}
