import type { BriefView, ItemRecord } from '@heist/shared';
import type { PgDatabase } from '../pg/PgDatabase';
import type { AttemptEvent, AttemptSink, AttemptWho } from './AttemptSink';

export interface BriefFilter {
  /** Only these classes (a teacher's own); undefined = every class (an admin). */
  readonly classIds?: readonly number[];
  readonly status?: 'unmarked' | 'marked' | 'all';
  readonly limit?: number;
}

// Pattern: Repository — Why: the game server hands briefs in and the admin marks them; both use
// this contract (PostgreSQL in production, memory in development and tests).
export interface BriefStore {
  /** Saves a handed-in brief (from its item record); a repeat of the same challenge is ignored. */
  add(item: ItemRecord): Promise<void>;
  list(filter?: BriefFilter): Promise<BriefView[]>;
  get(id: string): Promise<BriefView | null>;
  /** Records the marks; returns the brief before and after, or null if there is no such brief. */
  mark(
    id: string,
    marks: readonly number[],
    feedback: string | null,
    by: string,
    at: number,
  ): Promise<{ before: BriefView; after: BriefView } | null>;
  ofPlayer(playerId: number): Promise<BriefView[]>;
  /** Deletes briefs handed in before `before` (retention); returns how many. */
  deleteBefore(before: Date): Promise<number>;
}

/** The brief part of an item record, as a stored row (unmarked). */
export function briefFromItem(item: ItemRecord): BriefView | null {
  if (!item.brief) return null;
  return {
    id: item.challengeId,
    playerId: item.accountId ?? null,
    classId: item.classId ?? null,
    round: item.round ?? null,
    questionId: item.questionId,
    questionVersion: item.questionVersion,
    title: item.review?.title ?? '',
    story: item.review?.story ?? '',
    rcsbe: item.rcsbe,
    bloom: item.bloom,
    itemMarks: item.marks,
    topics: item.topics,
    rubric: item.brief.rubric,
    text: item.brief.text,
    sql: item.brief.sql,
    submittedAt: item.finishedAt,
    marks: null,
    feedback: null,
    markedBy: null,
    markedAt: null,
  };
}

const matches = (b: BriefView, f: BriefFilter) =>
  (f.classIds === undefined || (b.classId !== null && f.classIds.includes(b.classId))) &&
  (f.status === undefined ||
    f.status === 'all' ||
    (f.status === 'marked' ? b.marks !== null : b.marks === null));

export class InMemoryBriefStore implements BriefStore {
  private readonly rows = new Map<string, BriefView>();

  async add(item: ItemRecord) {
    const brief = briefFromItem(item);
    if (brief && !this.rows.has(brief.id)) this.rows.set(brief.id, brief);
  }

  async list(filter: BriefFilter = {}) {
    return [...this.rows.values()]
      .filter((b) => matches(b, filter))
      .sort((a, b) => a.submittedAt - b.submittedAt)
      .slice(0, filter.limit ?? 500);
  }

  async get(id: string) {
    return this.rows.get(id) ?? null;
  }

  async mark(
    id: string,
    marks: readonly number[],
    feedback: string | null,
    by: string,
    at: number,
  ) {
    const before = this.rows.get(id);
    if (!before) return null;
    const after = { ...before, marks: [...marks], feedback, markedBy: by, markedAt: at };
    this.rows.set(id, after);
    return { before, after };
  }

  async ofPlayer(playerId: number) {
    return [...this.rows.values()].filter((b) => b.playerId === playerId);
  }

  async deleteBefore(before: Date) {
    let n = 0;
    for (const [id, b] of this.rows)
      if (b.submittedAt < before.getTime()) {
        this.rows.delete(id);
        n++;
      }
    return n;
  }
}

interface BriefRow {
  challenge_id: string;
  player_id: string | null;
  player_name?: string | null;
  class_id: string | null;
  round: number | null;
  question_id: string;
  question_version: number;
  title: string;
  story: string;
  rcsbe: BriefView['rcsbe'];
  bloom: BriefView['bloom'];
  item_marks: string;
  topics: string[];
  rubric: BriefView['rubric'];
  text: string;
  sql: string;
  submitted_at: Date;
  marks: number[] | null;
  feedback: string | null;
  marked_by: string | null;
  marked_at: Date | null;
  [column: string]: unknown;
}

const toView = (r: BriefRow): BriefView => ({
  id: r.challenge_id,
  playerId: r.player_id === null ? null : Number(r.player_id),
  ...(r.player_name ? { playerName: r.player_name } : {}),
  classId: r.class_id === null ? null : Number(r.class_id),
  round: r.round,
  questionId: Number(r.question_id),
  questionVersion: r.question_version,
  title: r.title,
  story: r.story,
  rcsbe: r.rcsbe,
  bloom: r.bloom,
  itemMarks: Number(r.item_marks),
  topics: r.topics,
  rubric: r.rubric,
  text: r.text,
  sql: r.sql,
  submittedAt: r.submitted_at.getTime(),
  marks: r.marks,
  feedback: r.feedback,
  markedBy: r.marked_by,
  markedAt: r.marked_at === null ? null : r.marked_at.getTime(),
});

const SELECT = `SELECT b.*, p.display_name AS player_name FROM brief_submissions b
  LEFT JOIN players p ON p.id = b.player_id`;

export class PgBriefStore implements BriefStore {
  constructor(private readonly db: PgDatabase) {}

  async add(item: ItemRecord) {
    const b = briefFromItem(item);
    if (!b) return;
    await this.db.query(
      `INSERT INTO brief_submissions (challenge_id, player_id, class_id, round, question_id, question_version,
         title, story, rcsbe, bloom, item_marks, topics, rubric, text, sql, submitted_at)
       VALUES ($1, (SELECT id FROM players WHERE id = $2), (SELECT id FROM classes WHERE id = $3), $4, $5, $6,
         $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (challenge_id) DO NOTHING`,
      [
        b.id,
        b.playerId,
        b.classId,
        b.round,
        b.questionId,
        b.questionVersion,
        b.title,
        b.story,
        b.rcsbe,
        b.bloom,
        b.itemMarks,
        JSON.stringify(b.topics),
        JSON.stringify(b.rubric),
        b.text,
        b.sql,
        new Date(b.submittedAt),
      ],
    );
  }

  async list(filter: BriefFilter = {}) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.classIds !== undefined) {
      args.push(filter.classIds);
      where.push(`b.class_id = ANY($${args.length}::bigint[])`);
    }
    if (filter.status === 'marked') where.push('b.marked_at IS NOT NULL');
    if (filter.status === 'unmarked') where.push('b.marked_at IS NULL');
    args.push(filter.limit ?? 500);
    const rows = await this.db.query<BriefRow>(
      `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY b.submitted_at LIMIT $${args.length}`,
      args,
    );
    return rows.map(toView);
  }

  async get(id: string) {
    const row = await this.db.one<BriefRow>(`${SELECT} WHERE b.challenge_id = $1`, [id]);
    return row ? toView(row) : null;
  }

  async mark(
    id: string,
    marks: readonly number[],
    feedback: string | null,
    by: string,
    at: number,
  ) {
    return this.db.tx(async (tx) => {
      const rows = await tx.query<BriefRow>(`${SELECT} WHERE b.challenge_id = $1 FOR UPDATE OF b`, [
        id,
      ]);
      const before = rows[0];
      if (!before) return null;
      await tx.query(
        `UPDATE brief_submissions SET marks = $2, feedback = $3, marked_by = $4, marked_at = $5
         WHERE challenge_id = $1`,
        [id, JSON.stringify(marks), feedback, by, new Date(at)],
      );
      const view = toView(before);
      return {
        before: view,
        after: { ...view, marks: [...marks], feedback, markedBy: by, markedAt: at },
      };
    });
  }

  async ofPlayer(playerId: number) {
    const rows = await this.db.query<BriefRow>(
      `${SELECT} WHERE b.player_id = $1 ORDER BY b.submitted_at`,
      [playerId],
    );
    return rows.map(toView);
  }

  async deleteBefore(before: Date) {
    const rows = await this.db.query(
      'DELETE FROM brief_submissions WHERE submitted_at < $1 RETURNING challenge_id',
      [before],
    );
    return rows.length;
  }
}

/** Saves handed-in briefs as they arrive (one more listener on "a question ended"). */
export class BriefSink implements AttemptSink {
  constructor(
    private readonly store: BriefStore,
    private readonly onError: (err: unknown) => void = () => {},
  ) {}

  event(_event: AttemptEvent): void {}

  item(item: ItemRecord, _who: AttemptWho): void {
    if (item.outcome === 'submitted' && item.brief) void this.store.add(item).catch(this.onError);
  }
}
