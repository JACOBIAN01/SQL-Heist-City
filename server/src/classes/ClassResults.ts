import type { AwardView } from '@heist/shared';
import type { PgDatabase } from '../pg/PgDatabase';
import type { RoundResult } from '../heist/HeistEvents';

/** A stored finished round, without its table of students. */
export interface StoredRound {
  readonly id: number;
  readonly classId: number;
  readonly number: number;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly awards: readonly AwardView[];
  readonly players: number;
  /** Name and banked cash of whoever won (the most banked), if anyone banked. */
  readonly winner: { readonly name: string; readonly banked: number } | null;
}

export interface StoredStanding {
  readonly rank: number;
  readonly playerId: number | null;
  readonly name: string;
  readonly banked: number;
  readonly kills: number;
  readonly deaths: number;
}

// Pattern: Repository — Why: results are written by the game server and read by the admin, on
// different processes; both use this contract.
export interface ClassResultRepository {
  record(classId: number, result: RoundResult): Promise<StoredRound>;
  /** A class's finished rounds, newest first. */
  rounds(classId: number): Promise<StoredRound[]>;
  /** One round with its full table, or undefined (also when it belongs to another class). */
  round(
    classId: number,
    roundId: number,
  ): Promise<{ round: StoredRound; standings: StoredStanding[] } | undefined>;
  /** A student's results across a class's rounds. */
  forPlayer(
    classId: number,
    playerId: number,
  ): Promise<{ round: StoredRound; standing: StoredStanding }[]>;
}

const winnerOf = (standings: readonly { name: string; banked: number }[]) => {
  const top = standings[0];
  return top && top.banked > 0 ? { name: top.name, banked: top.banked } : null;
};

export class InMemoryClassResults implements ClassResultRepository {
  private readonly rows: { round: StoredRound; standings: StoredStanding[] }[] = [];
  private nextId = 1;

  async record(classId: number, result: RoundResult) {
    const standings = result.standings.map((s) => ({
      rank: s.rank,
      playerId: s.accountId ?? null,
      name: s.name,
      banked: s.banked,
      kills: s.kills,
      deaths: s.deaths,
    }));
    const round: StoredRound = {
      id: this.nextId++,
      classId,
      number: result.number,
      startedAt: new Date(result.startedAt).toISOString(),
      endedAt: new Date(result.endedAt).toISOString(),
      awards: result.awards,
      players: standings.length,
      winner: winnerOf(standings),
    };
    this.rows.push({ round, standings });
    return round;
  }

  async rounds(classId: number) {
    return this.rows
      .filter((r) => r.round.classId === classId)
      .map((r) => r.round)
      .sort((a, b) => b.id - a.id);
  }

  async round(classId: number, roundId: number) {
    const found = this.rows.find((r) => r.round.id === roundId && r.round.classId === classId);
    return found && { round: found.round, standings: found.standings };
  }

  async forPlayer(classId: number, playerId: number) {
    return this.rows
      .filter((r) => r.round.classId === classId)
      .flatMap((r) => {
        const standing = r.standings.find((s) => s.playerId === playerId);
        return standing ? [{ round: r.round, standing }] : [];
      })
      .sort((a, b) => a.round.id - b.round.id);
  }
}

interface RoundRow {
  id: string;
  class_id: string;
  number: number;
  started_at: Date;
  ended_at: Date;
  awards: AwardView[];
  players: string | number;
  winner_name: string | null;
  winner_banked: string | null;
  [column: string]: unknown;
}

const ROUND_SQL = `
  SELECT r.*, (SELECT count(*) FROM class_results c WHERE c.round_id = r.id) AS players,
         (SELECT name FROM class_results c WHERE c.round_id = r.id AND c.rank = 1 AND c.banked > 0) AS winner_name,
         (SELECT banked FROM class_results c WHERE c.round_id = r.id AND c.rank = 1 AND c.banked > 0) AS winner_banked
  FROM class_rounds r`;

const toRound = (r: RoundRow): StoredRound => ({
  id: Number(r.id),
  classId: Number(r.class_id),
  number: r.number,
  startedAt: r.started_at.toISOString(),
  endedAt: r.ended_at.toISOString(),
  awards: r.awards,
  players: Number(r.players),
  winner: r.winner_name === null ? null : { name: r.winner_name, banked: Number(r.winner_banked) },
});

interface StandingRow {
  rank: number;
  player_id: string | null;
  name: string;
  banked: string;
  kills: number;
  deaths: number;
  [column: string]: unknown;
}

const toStanding = (s: StandingRow): StoredStanding => ({
  rank: s.rank,
  playerId: s.player_id === null ? null : Number(s.player_id),
  name: s.name,
  banked: Number(s.banked),
  kills: s.kills,
  deaths: s.deaths,
});

export class PgClassResults implements ClassResultRepository {
  constructor(private readonly db: PgDatabase) {}

  async record(classId: number, result: RoundResult): Promise<StoredRound> {
    const id = await this.db.tx(async (tx) => {
      const row = await tx.one<{ id: string }>(
        `INSERT INTO class_rounds (class_id, number, started_at, ended_at, awards)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          classId,
          result.number,
          new Date(result.startedAt),
          new Date(result.endedAt),
          JSON.stringify(result.awards),
        ],
      );
      const roundId = Number((row as { id: string }).id);
      for (const s of result.standings) {
        // An account removed since (deleted) leaves a nameless-to-the-account row, so insert only known players.
        const known =
          s.accountId === undefined
            ? undefined
            : await tx.one('SELECT 1 FROM players WHERE id = $1', [s.accountId]);
        await tx.query(
          `INSERT INTO class_results (round_id, rank, player_id, name, banked, kills, deaths)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [roundId, s.rank, known ? s.accountId : null, s.name, s.banked, s.kills, s.deaths],
        );
      }
      return roundId;
    });
    return (await this.round(classId, id))?.round as StoredRound;
  }

  async rounds(classId: number): Promise<StoredRound[]> {
    const rows = await this.db.query<RoundRow>(
      `${ROUND_SQL} WHERE r.class_id = $1 ORDER BY r.id DESC`,
      [classId],
    );
    return rows.map(toRound);
  }

  async round(classId: number, roundId: number) {
    const row = await this.db.one<RoundRow>(`${ROUND_SQL} WHERE r.id = $1 AND r.class_id = $2`, [
      roundId,
      classId,
    ]);
    if (!row) return undefined;
    const standings = await this.db.query<StandingRow>(
      'SELECT * FROM class_results WHERE round_id = $1 ORDER BY rank',
      [roundId],
    );
    return { round: toRound(row), standings: standings.map(toStanding) };
  }

  async forPlayer(classId: number, playerId: number) {
    const rows = await this.db.query<RoundRow & StandingRow>(
      `SELECT r.*, c.rank, c.player_id, c.name, c.banked, c.kills, c.deaths,
              (SELECT count(*) FROM class_results x WHERE x.round_id = r.id) AS players,
              NULL AS winner_name, NULL AS winner_banked
       FROM class_rounds r JOIN class_results c ON c.round_id = r.id
       WHERE r.class_id = $1 AND c.player_id = $2 ORDER BY r.id`,
      [classId, playerId],
    );
    return rows.map((r) => ({ round: toRound(r), standing: toStanding(r) }));
  }
}
