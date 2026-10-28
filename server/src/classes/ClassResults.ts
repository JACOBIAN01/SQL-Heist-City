import { REPLAYS_KEPT_PER_CLASS, type AwardView, type RoundReplay } from '@heist/shared';
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
  /** The round was recorded and can still be replayed (Phase 35.2). */
  readonly hasReplay: boolean;
}

export interface StoredStanding {
  readonly rank: number;
  readonly playerId: number | null;
  readonly name: string;
  readonly banked: number;
  readonly kills: number;
  readonly deaths: number;
}

/** What one student did across a class's rounds in a period. */
export interface PeriodTotal {
  readonly playerId: number;
  readonly name: string;
  readonly banked: number;
  readonly rounds: number;
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
  /** The recording of a round, or undefined (none kept, or the round belongs to another class). */
  replay(classId: number, roundId: number): Promise<RoundReplay | undefined>;
  /** Per student: cash banked and rounds played in rounds that ended in [from, to). */
  totalsBetween(classId: number, from: Date, to: Date): Promise<PeriodTotal[]>;
  /** A student's most recent rounds over every class, newest first. */
  recentForPlayer(
    playerId: number,
    limit: number,
  ): Promise<{ round: StoredRound; standing: StoredStanding }[]>;
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
  private readonly rows: {
    round: StoredRound;
    standings: StoredStanding[];
    replay: RoundReplay | undefined;
  }[] = [];
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
      hasReplay: result.replay !== undefined,
    };
    this.rows.push({ round, standings, replay: result.replay });
    // Only the newest recordings are kept.
    const mine = this.rows.filter((r) => r.round.classId === classId && r.replay);
    for (const old of mine.slice(0, -REPLAYS_KEPT_PER_CLASS)) {
      old.replay = undefined;
      this.rows[this.rows.indexOf(old)] = { ...old, round: { ...old.round, hasReplay: false } };
    }
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

  async replay(classId: number, roundId: number) {
    return this.rows.find((r) => r.round.id === roundId && r.round.classId === classId)?.replay;
  }

  async totalsBetween(classId: number, from: Date, to: Date) {
    const totals = new Map<number, { name: string; banked: number; rounds: number }>();
    for (const { round, standings } of this.rows) {
      const ended = Date.parse(round.endedAt);
      if (round.classId !== classId || ended < from.getTime() || ended >= to.getTime()) continue;
      for (const s of standings) {
        if (s.playerId === null) continue;
        const t = totals.get(s.playerId) ?? { name: s.name, banked: 0, rounds: 0 };
        totals.set(s.playerId, { name: s.name, banked: t.banked + s.banked, rounds: t.rounds + 1 });
      }
    }
    return [...totals].map(([playerId, t]) => ({ playerId, ...t }));
  }

  async recentForPlayer(playerId: number, limit: number) {
    return this.rows
      .flatMap((r) => {
        const standing = r.standings.find((s) => s.playerId === playerId);
        return standing ? [{ round: r.round, standing }] : [];
      })
      .sort((a, b) => b.round.id - a.round.id)
      .slice(0, limit);
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
  has_replay: boolean;
  [column: string]: unknown;
}

const ROUND_SQL = `
  SELECT r.id, r.class_id, r.number, r.started_at, r.ended_at, r.awards, (r.replay IS NOT NULL) AS has_replay,
         (SELECT count(*) FROM class_results c WHERE c.round_id = r.id) AS players,
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
  hasReplay: r.has_replay,
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

  async totalsBetween(classId: number, from: Date, to: Date): Promise<PeriodTotal[]> {
    const rows = await this.db.query<{
      player_id: string;
      name: string;
      banked: string;
      rounds: string;
    }>(
      `SELECT c.player_id, (array_agg(c.name ORDER BY r.ended_at DESC))[1] AS name,
              sum(c.banked) AS banked, count(*) AS rounds
       FROM class_results c JOIN class_rounds r ON r.id = c.round_id
       WHERE r.class_id = $1 AND r.ended_at >= $2 AND r.ended_at < $3 AND c.player_id IS NOT NULL
       GROUP BY c.player_id`,
      [classId, from, to],
    );
    return rows.map((r) => ({
      playerId: Number(r.player_id),
      name: r.name,
      banked: Number(r.banked),
      rounds: Number(r.rounds),
    }));
  }

  async record(classId: number, result: RoundResult): Promise<StoredRound> {
    const id = await this.db.tx(async (tx) => {
      const row = await tx.one<{ id: string }>(
        `INSERT INTO class_rounds (class_id, number, started_at, ended_at, awards, replay)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          classId,
          result.number,
          new Date(result.startedAt),
          new Date(result.endedAt),
          JSON.stringify(result.awards),
          result.replay ? JSON.stringify(result.replay) : null,
        ],
      );
      // Only the newest recordings are kept; the round's table stays.
      await tx.query(
        `UPDATE class_rounds SET replay = NULL
          WHERE class_id = $1 AND replay IS NOT NULL
            AND id NOT IN (SELECT id FROM class_rounds WHERE class_id = $1 AND replay IS NOT NULL
                           ORDER BY id DESC LIMIT $2)`,
        [classId, REPLAYS_KEPT_PER_CLASS],
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

  async replay(classId: number, roundId: number) {
    const row = await this.db.one<{ replay: RoundReplay | null }>(
      'SELECT replay FROM class_rounds WHERE id = $1 AND class_id = $2',
      [roundId, classId],
    );
    return row?.replay ?? undefined;
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

  async recentForPlayer(playerId: number, limit: number) {
    const rows = await this.db.query<RoundRow & StandingRow>(
      `SELECT r.*, c.rank, c.player_id, c.name, c.banked, c.kills, c.deaths,
              (SELECT count(*) FROM class_results x WHERE x.round_id = r.id) AS players,
              NULL AS winner_name, NULL AS winner_banked
       FROM class_rounds r JOIN class_results c ON c.round_id = r.id
       WHERE c.player_id = $1 ORDER BY r.id DESC LIMIT $2`,
      [playerId, limit],
    );
    return rows.map((r) => ({ round: toRound(r), standing: toStanding(r) }));
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
