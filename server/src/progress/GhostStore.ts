import type { GhostTrace } from '@heist/shared';
import type { PgDatabase } from '../pg/PgDatabase';

export interface GhostRun {
  readonly bank: string;
  readonly playerId: number;
  readonly name: string;
  readonly seconds: number;
  readonly take: number;
  readonly trace: GhostTrace;
}

/** Whether run `a` beats run `b`: the faster heist, then the bigger take. */
export const faster = (
  a: { seconds: number; take: number },
  b: { seconds: number; take: number },
) => a.seconds < b.seconds || (a.seconds === b.seconds && a.take > b.take);

// Pattern: Repository — Why: the match keeps each student's fastest run per bank and reads the
// fastest of all as the ghost; PostgreSQL in production, memory in tests, one contract for both.
export interface GhostStore {
  /** Keeps the run if it is this student's best on the bank; true if it was kept. */
  save(run: GhostRun): Promise<boolean>;
  /** The fastest run on a bank, by anyone. */
  best(bank: string): Promise<GhostRun | undefined>;
  remove(playerId: number): Promise<void>;
}

export class PgGhostStore implements GhostStore {
  constructor(private readonly db: PgDatabase) {}

  async save(run: GhostRun) {
    const was = await this.db.one<{ seconds: number; take: number }>(
      'SELECT seconds, take FROM ghost_heists WHERE bank = $1 AND player_id = $2',
      [run.bank, run.playerId],
    );
    if (was && !faster(run, { seconds: Number(was.seconds), take: Number(was.take) })) return false;
    await this.db.query(
      `INSERT INTO ghost_heists (bank, player_id, seconds, take, trace) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (bank, player_id) DO UPDATE
         SET seconds = excluded.seconds, take = excluded.take, trace = excluded.trace,
             achieved_at = now()`,
      [run.bank, run.playerId, run.seconds, run.take, JSON.stringify(run.trace)],
    );
    return true;
  }

  async best(bank: string) {
    const row = await this.db.one<{
      player_id: string;
      display_name: string;
      seconds: number;
      take: number;
      trace: GhostTrace;
    }>(
      `SELECT g.player_id, p.display_name, g.seconds, g.take, g.trace
         FROM ghost_heists g JOIN players p ON p.id = g.player_id
        WHERE g.bank = $1 ORDER BY g.seconds ASC, g.take DESC, g.achieved_at ASC LIMIT 1`,
      [bank],
    );
    return row
      ? {
          bank,
          playerId: Number(row.player_id),
          name: row.display_name,
          seconds: Number(row.seconds),
          take: Number(row.take),
          trace: row.trace,
        }
      : undefined;
  }

  async remove(playerId: number) {
    await this.db.query('DELETE FROM ghost_heists WHERE player_id = $1', [playerId]);
  }
}

export class InMemoryGhostStore implements GhostStore {
  private readonly runs = new Map<string, GhostRun>();
  private readonly order = new Map<string, number>();
  private clock = 0;

  async save(run: GhostRun) {
    const key = `${run.bank}:${run.playerId}`;
    const was = this.runs.get(key);
    if (was && !faster(run, was)) return false;
    this.runs.set(key, run);
    this.order.set(key, ++this.clock);
    return true;
  }

  async best(bank: string) {
    return [...this.runs.entries()]
      .filter(([, r]) => r.bank === bank)
      .sort(
        ([ka, a], [kb, b]) =>
          a.seconds - b.seconds ||
          b.take - a.take ||
          (this.order.get(ka) ?? 0) - (this.order.get(kb) ?? 0),
      )[0]?.[1];
  }

  async remove(playerId: number) {
    for (const [key, r] of this.runs) if (r.playerId === playerId) this.runs.delete(key);
  }
}
