import { GHOST_MAX_SECONDS, type GhostMessage, type GhostResultMessage } from '@heist/shared';
import type { Player } from '../game/Player';
import { faster, type GhostRun, type GhostStore } from '../progress/GhostStore';
import type { HeistEvents } from './HeistEvents';
import type { MatchApi } from './MatchApi';

interface Run {
  readonly bank: string;
  readonly startTick: number;
  readonly points: number[];
}

/** A heist shorter than this (s) is not worth a ghost. */
const MIN_SECONDS = 5;

/**
 * Async ghost heists (Phase 34.6). From a student's first move on a bank (gathering intel or cracking
 * a lock) their position is noted each second; a heist that ends in the bank is kept as their run,
 * and the fastest run on each bank becomes the ghost the next student races: the moment they begin
 * on that bank the ghost is sent to them, to be replayed beside them from that instant, and when
 * they finish they are told whether they beat it.
 * Pattern: Observer — Why: it follows the heist's own events and leaves the rules alone.
 */
export class GhostSystem {
  private store: GhostStore | undefined;
  private readonly runs = new Map<Player, Run>();

  constructor(
    private readonly match: MatchApi,
    events: HeistEvents,
    private readonly active: () => boolean,
  ) {
    events.subscribe((e) => {
      if (!this.active()) return;
      if (e.type === 'intel_gained') this.begin(e.player, e.bank);
      else if (e.type === 'lock_opened' && e.player)
        this.begin(e.player, `bank-${e.vault.spec.tier}`);
      else if (e.type === 'heist_complete') void this.finish(e.player, e.bank, e.take ?? 0);
    });
  }

  bindStore(store: GhostStore): void {
    this.store = store;
  }

  /** The run a player is on (for tests). */
  runOf(player: Player): Readonly<Run> | undefined {
    return this.runs.get(player);
  }

  private begin(player: Player, bank: string): void {
    const run = this.runs.get(player);
    if (run?.bank === bank) return;
    this.runs.set(player, { bank, startTick: this.match.tick, points: [] });
    this.sample(player);
    const store = this.store;
    if (!store) return;
    void store
      .best(bank)
      .then((best) => {
        if (!best || !this.runs.has(player)) return;
        const message: GhostMessage = {
          t: 'ghost',
          bank,
          name: best.name,
          seconds: best.seconds,
          take: best.take,
          mine: player.accountId !== undefined && best.playerId === player.accountId,
          trace: best.trace,
        };
        this.match.sendJson(player, message);
      })
      .catch(() => {});
  }

  /** The player's run is over without a heist (they died or left). */
  drop(player: Player): void {
    this.runs.delete(player);
  }

  reset(): void {
    this.runs.clear();
  }

  /** Every tick: once a second, where each runner stands. */
  onTick(): void {
    if (this.match.tick % this.match.tickRate !== 0) return;
    for (const player of this.runs.keys()) this.sample(player);
  }

  private sample(player: Player): void {
    const run = this.runs.get(player);
    if (!run || run.points.length >= GHOST_MAX_SECONDS * 3) return;
    const r = (n: number) => Math.round(n * 10) / 10;
    run.points.push(r(player.body.x), r(player.body.y), r(player.body.z));
  }

  private async finish(player: Player, bank: string, take: number): Promise<void> {
    const run = this.runs.get(player);
    this.runs.delete(player);
    if (!run || run.bank !== bank) return;
    const seconds = Math.round((this.match.tick - run.startTick) / this.match.tickRate);
    if (seconds < MIN_SECONDS) return;
    this.sample2(run, player);
    const store = this.store;
    const mine: GhostRun | undefined =
      player.accountId === undefined
        ? undefined
        : {
            bank,
            playerId: player.accountId,
            name: player.name,
            seconds,
            take,
            trace: { step: 1, points: run.points },
          };
    try {
      const best = await store?.best(bank);
      const beat = !best || faster({ seconds, take }, best);
      const saved = mine && store ? await store.save(mine) : false;
      const message: GhostResultMessage = {
        t: 'ghost_result',
        bank,
        ...(best ? { ghost: { name: best.name, seconds: best.seconds } } : {}),
        seconds,
        beat,
        record: saved && beat,
      };
      this.match.sendJson(player, message);
    } catch {
      // A failed save never touches the heist.
    }
  }

  /** The last position, at the end of the run. */
  private sample2(run: Run, player: Player): void {
    if (run.points.length < GHOST_MAX_SECONDS * 3)
      run.points.push(
        Math.round(player.body.x * 10) / 10,
        Math.round(player.body.y * 10) / 10,
        Math.round(player.body.z * 10) / 10,
      );
  }
}
