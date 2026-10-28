import { log } from '../log';
/**
 * Things an honest client never does (Phase 18.3). The server already refuses or corrects each
 * of them; this log is so a teacher or operator can see who is trying, and so a server bug that
 * let one through would show up.
 */
export type AnomalyKind =
  /** More input than real time allows: commands were dropped (a speed hack sends extra). */
  | 'input_flood'
  /** A shot claimed more lag than the server rewinds (to hit where someone used to be). */
  | 'lag_claim'
  /** Moved further in one tick than any legal input could. */
  | 'speed'
  /** More shots from one gun in a second than its fire rate allows. */
  | 'fire_rate'
  /** A hit whose line from the gun to the target crosses a wall. */
  | 'hit_through_wall'
  /** Asked for something the client never offers (an anchor out of reach, an unknown task). */
  | 'impossible_action'
  /** A JSON message that does not match the protocol. */
  | 'malformed'
  /** A wrong cheat code was typed (never the code itself). */
  | 'bad_cheat_code';

export interface Anomaly {
  readonly at: number;
  readonly tick: number;
  readonly player: string;
  readonly accountId?: number;
  readonly kind: AnomalyKind;
  readonly detail?: Record<string, unknown>;
}

/** One structured line per anomaly, for the log collector. */
export const logAnomaly = (a: Anomaly): void => log.warn('anomaly', { ...a });

export class AnomalyLog {
  private readonly totals = new Map<AnomalyKind, number>();
  private readonly byPlayer = new Map<string, Map<AnomalyKind, number>>();

  constructor(
    private readonly sink: (a: Anomaly) => void = logAnomaly,
    /** Lines written per player and kind; the rest are only counted (a flood of one cheat stays one line). */
    private readonly linesPerKind = 3,
  ) {}

  record(a: Anomaly): void {
    this.totals.set(a.kind, (this.totals.get(a.kind) ?? 0) + 1);
    let mine = this.byPlayer.get(a.player);
    if (!mine) this.byPlayer.set(a.player, (mine = new Map()));
    const n = (mine.get(a.kind) ?? 0) + 1;
    mine.set(a.kind, n);
    if (n <= this.linesPerKind) this.sink(a);
  }

  /** Counts by kind, for `/metrics`. */
  counts(): Partial<Record<AnomalyKind, number>> {
    return Object.fromEntries(this.totals);
  }

  /** One player's counts by kind. */
  of(player: string): Partial<Record<AnomalyKind, number>> {
    return Object.fromEntries(this.byPlayer.get(player) ?? []);
  }

  /** Players with at least `min` anomalies, most first. */
  suspects(min = 10): { player: string; total: number }[] {
    return [...this.byPlayer]
      .map(([player, kinds]) => ({ player, total: [...kinds.values()].reduce((s, n) => s + n, 0) }))
      .filter((s) => s.total >= min)
      .sort((a, b) => b.total - a.total);
  }

  forget(player: string): void {
    this.byPlayer.delete(player);
  }
}
