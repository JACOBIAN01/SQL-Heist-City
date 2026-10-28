import type { QueryCost } from '@heist/shared';
import { betterCost } from '@heist/shared';
import type { PgDatabase } from '../pg/PgDatabase';

export interface BoardRow {
  readonly rank: number;
  readonly playerId: number;
  readonly name: string;
  readonly scanned: number;
  readonly length: number;
}

/** Where a student stands on a question, and the top of the table. */
export interface BoardView {
  readonly rank: number;
  readonly of: number;
  readonly top: readonly BoardRow[];
}

// Pattern: Repository — Why: the match records each student's leanest query per question; PostgreSQL
// in production, memory in tests, one contract for both.
export interface LeaderboardStore {
  /** Keeps the student's best cost for the question; true if this one is a new best. */
  record(
    playerId: number,
    name: string,
    classId: number | null,
    questionId: number,
    cost: QueryCost,
  ): Promise<boolean>;
  /** The table for a question: everyone, or only a class; best first. */
  board(
    questionId: number,
    playerId: number,
    scope: { readonly classId?: number },
    top: number,
  ): Promise<BoardView | undefined>;
  remove(playerId: number): Promise<void>;
}

export class PgLeaderboardStore implements LeaderboardStore {
  constructor(private readonly db: PgDatabase) {}

  async record(
    playerId: number,
    _name: string,
    classId: number | null,
    questionId: number,
    cost: QueryCost,
  ) {
    const was = await this.db.one<{ scanned: number; length: number }>(
      'SELECT scanned, length FROM query_records WHERE question_id = $1 AND player_id = $2',
      [questionId, playerId],
    );
    if (was && !betterCost(cost, { scanned: Number(was.scanned), length: Number(was.length) }))
      return false;
    await this.db.query(
      `INSERT INTO query_records (question_id, player_id, class_id, scanned, length)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (question_id, player_id) DO UPDATE
         SET class_id = excluded.class_id, scanned = excluded.scanned, length = excluded.length,
             achieved_at = now()`,
      [questionId, playerId, classId, cost.scanned, cost.length],
    );
    return true;
  }

  async board(questionId: number, playerId: number, scope: { classId?: number }, top: number) {
    const where = scope.classId === undefined ? '' : 'AND r.class_id = $2';
    const params = scope.classId === undefined ? [questionId] : [questionId, scope.classId];
    const rows = await this.db.query<{
      player_id: string;
      display_name: string;
      scanned: number;
      length: number;
    }>(
      `SELECT r.player_id, p.display_name, r.scanned, r.length
         FROM query_records r JOIN players p ON p.id = r.player_id
        WHERE r.question_id = $1 ${where}
        ORDER BY r.scanned ASC, r.length ASC, r.achieved_at ASC`,
      params,
    );
    const all = rows.map((r, i) => ({
      rank: i + 1,
      playerId: Number(r.player_id),
      name: r.display_name,
      scanned: Number(r.scanned),
      length: Number(r.length),
    }));
    const mine = all.find((r) => r.playerId === playerId);
    if (!mine) return undefined;
    return { rank: mine.rank, of: all.length, top: all.slice(0, top) };
  }

  async remove(playerId: number) {
    await this.db.query('DELETE FROM query_records WHERE player_id = $1', [playerId]);
  }
}

export class InMemoryLeaderboardStore implements LeaderboardStore {
  private readonly rows: {
    questionId: number;
    playerId: number;
    name: string;
    classId: number | null;
    cost: QueryCost;
    at: number;
  }[] = [];
  private clock = 0;

  async record(
    playerId: number,
    name: string,
    classId: number | null,
    questionId: number,
    cost: QueryCost,
  ) {
    const i = this.rows.findIndex((r) => r.questionId === questionId && r.playerId === playerId);
    const was = this.rows[i];
    if (was && !betterCost(cost, was.cost)) return false;
    const next = { questionId, playerId, name, classId, cost, at: ++this.clock };
    if (i >= 0) this.rows[i] = next;
    else this.rows.push(next);
    return true;
  }

  async board(questionId: number, playerId: number, scope: { classId?: number }, top: number) {
    const all = this.rows
      .filter((r) => r.questionId === questionId)
      .filter((r) => scope.classId === undefined || r.classId === scope.classId)
      .sort(
        (a, b) => a.cost.scanned - b.cost.scanned || a.cost.length - b.cost.length || a.at - b.at,
      )
      .map((r, i) => ({
        rank: i + 1,
        playerId: r.playerId,
        name: r.name,
        scanned: r.cost.scanned,
        length: r.cost.length,
      }));
    const mine = all.find((r) => r.playerId === playerId);
    if (!mine) return undefined;
    return { rank: mine.rank, of: all.length, top: all.slice(0, top) };
  }

  async remove(playerId: number) {
    for (let i = this.rows.length - 1; i >= 0; i--)
      if (this.rows[i]?.playerId === playerId) this.rows.splice(i, 1);
  }
}
