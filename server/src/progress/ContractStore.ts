import type { ContractState, DayStreak } from '@heist/shared';
import type { PgDatabase } from '../pg/PgDatabase';

// Pattern: Repository — Why: the match reads and updates a student's contracts as questions end;
// PostgreSQL in production, memory in tests, one contract for both.
export interface ContractStore {
  /** The contracts dealt for a day, or undefined when none were dealt yet. */
  getDay(playerId: number, day: string): Promise<ContractState[] | undefined>;
  putDay(playerId: number, day: string, state: readonly ContractState[]): Promise<void>;
  getStreak(playerId: number): Promise<DayStreak>;
  putStreak(playerId: number, streak: DayStreak): Promise<void>;
  /** Forgets days before `day` (the retention job). Returns how many rows went. */
  pruneBefore(day: string): Promise<number>;
  /** Removes everything of a player (the database also does this with the account). */
  remove(playerId: number): Promise<void>;
}

export class PgContractStore implements ContractStore {
  constructor(private readonly db: PgDatabase) {}

  async getDay(playerId: number, day: string) {
    const row = await this.db.one<{ state: ContractState[] }>(
      `SELECT state FROM player_contracts WHERE player_id = $1 AND day = $2::date`,
      [playerId, day],
    );
    return row?.state;
  }

  async putDay(playerId: number, day: string, state: readonly ContractState[]) {
    await this.db.query(
      `INSERT INTO player_contracts (player_id, day, state) VALUES ($1, $2::date, $3)
       ON CONFLICT (player_id, day) DO UPDATE SET state = excluded.state`,
      [playerId, day, JSON.stringify(state)],
    );
  }

  async getStreak(playerId: number): Promise<DayStreak> {
    const row = await this.db.one<{ days: number; last_day: string | null }>(
      `SELECT days, to_char(last_day, 'YYYY-MM-DD') AS last_day FROM player_streaks WHERE player_id = $1`,
      [playerId],
    );
    return row ? { days: Number(row.days), lastDay: row.last_day ?? '' } : { days: 0, lastDay: '' };
  }

  async putStreak(playerId: number, streak: DayStreak) {
    await this.db.query(
      `INSERT INTO player_streaks (player_id, days, last_day) VALUES ($1, $2, NULLIF($3, '')::date)
       ON CONFLICT (player_id) DO UPDATE SET days = excluded.days, last_day = excluded.last_day, updated_at = now()`,
      [playerId, streak.days, streak.lastDay],
    );
  }

  async pruneBefore(day: string) {
    return (
      await this.db.query(`DELETE FROM player_contracts WHERE day < $1::date RETURNING player_id`, [
        day,
      ])
    ).length;
  }

  async remove(playerId: number) {
    await this.db.query('DELETE FROM player_contracts WHERE player_id = $1', [playerId]);
    await this.db.query('DELETE FROM player_streaks WHERE player_id = $1', [playerId]);
  }
}

export class InMemoryContractStore implements ContractStore {
  private readonly days = new Map<string, ContractState[]>();
  private readonly streaks = new Map<number, DayStreak>();

  async getDay(playerId: number, day: string) {
    return this.days.get(`${playerId}|${day}`);
  }

  async putDay(playerId: number, day: string, state: readonly ContractState[]) {
    this.days.set(`${playerId}|${day}`, [...state]);
  }

  async getStreak(playerId: number) {
    return this.streaks.get(playerId) ?? { days: 0, lastDay: '' };
  }

  async putStreak(playerId: number, streak: DayStreak) {
    this.streaks.set(playerId, streak);
  }

  async pruneBefore(day: string) {
    let n = 0;
    for (const key of [...this.days.keys()])
      if ((key.split('|')[1] ?? '') < day) {
        this.days.delete(key);
        n++;
      }
    return n;
  }

  async remove(playerId: number) {
    for (const key of [...this.days.keys()])
      if (key.startsWith(`${playerId}|`)) this.days.delete(key);
    this.streaks.delete(playerId);
  }
}
