import type { PgDatabase, PgTx } from '../pg/PgDatabase';
import { isUniqueViolation } from '../pg/PgDatabase';
import { newClassCode } from './classCode';
import type {
  ClassInput,
  ClassMember,
  ClassQuestionLink,
  ClassRecord,
  QuestionUsage,
  SquadMode,
} from '@heist/shared';

// Pattern: Repository — Why: the admin, the lobby and the match all read classes; they depend on this
// contract, tests use the in-memory one, production PostgreSQL.
export interface ClassRepository {
  /** Creates a class with a fresh, unique code. */
  create(input: ClassInput, ownerUserId: number | null): Promise<ClassRecord>;
  get(id: number): Promise<ClassRecord | undefined>;
  /** Finds a class by what a student typed (already normalised). */
  findByCode(code: string): Promise<ClassRecord | undefined>;
  /** A teacher's classes, or everyone's when `ownerUserId` is undefined. Archived ones only on request. */
  list(options?: { ownerUserId?: number; includeArchived?: boolean }): Promise<ClassRecord[]>;
  update(id: number, changes: Partial<ClassInput>): Promise<ClassRecord | undefined>;
  setLocked(id: number, locked: boolean): Promise<ClassRecord | undefined>;
  archive(id: number): Promise<ClassRecord | undefined>;
  /** Records the school's acceptance of the terms of this `version` (Phase 21.3). */
  acceptConsent(
    id: number,
    version: number,
    byUserId: number | null,
    now?: Date,
  ): Promise<ClassRecord | undefined>;
  /** Deletes archived classes archived before `before`, with their rosters and results; returns their ids. */
  deleteArchivedBefore(before: Date): Promise<number[]>;
  /** A new code (the old one stops working), for a class whose code leaked. */
  regenerateCode(id: number): Promise<ClassRecord | undefined>;

  /** Replaces the whole question set. Unknown question ids are an error. */
  setQuestions(id: number, links: readonly ClassQuestionLink[]): Promise<void>;
  questions(id: number): Promise<ClassQuestionLink[]>;

  /** Records that a player joined (once); returns false when they already had. */
  addMember(classId: number, playerId: number, now?: Date): Promise<boolean>;
  members(classId: number): Promise<ClassMember[]>;
  isMember(classId: number, playerId: number): Promise<boolean>;

  /** Who is in which squad: student id → squad number (Phase 27). */
  squads(classId: number): Promise<Record<number, number>>;
  /** Replaces the whole assignment. Students who are not members of the class are ignored. */
  setSquads(classId: number, assignments: Readonly<Record<number, number>>): Promise<void>;
}

export class UnknownClassQuestionsError extends Error {
  constructor(readonly ids: readonly number[]) {
    super(`unknown question ids: ${ids.join(', ')}`);
    this.name = 'UnknownClassQuestionsError';
  }
}

interface ClassRow {
  id: string | number;
  code: string;
  name: string;
  owner_user_id: string | number | null;
  city_seed: string | null;
  banks_open: number[];
  round_minutes: string | null;
  player_cap: number;
  dialect: string;
  mode: string;
  squad_mode: SquadMode;
  squad_size: number;
  locked: boolean;
  archived: boolean;
  archived_at: Date | null;
  consent_version: number | null;
  consent_user_id: string | number | null;
  consent_at: Date | null;
  created_at: Date;
  updated_at: Date;
  [column: string]: unknown;
}

const fromRow = (r: ClassRow): ClassRecord => ({
  id: Number(r.id),
  code: r.code,
  name: r.name,
  ownerUserId: r.owner_user_id === null ? null : Number(r.owner_user_id),
  citySeed: r.city_seed,
  banksOpen: r.banks_open,
  roundMinutes: r.round_minutes === null ? null : Number(r.round_minutes),
  playerCap: r.player_cap,
  dialect: r.dialect,
  mode: r.mode,
  squadMode: r.squad_mode,
  squadSize: r.squad_size,
  locked: r.locked,
  archived: r.archived,
  archivedAt: r.archived_at ? r.archived_at.toISOString() : null,
  consent:
    r.consent_version === null || r.consent_at === null
      ? null
      : {
          version: r.consent_version,
          byUserId: r.consent_user_id === null ? null : Number(r.consent_user_id),
          at: r.consent_at.toISOString(),
        },
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const CODE_TRIES = 20;

export class PgClassRepository implements ClassRepository {
  constructor(
    private readonly db: PgDatabase,
    private readonly makeCode: () => string = newClassCode,
  ) {}

  async create(input: ClassInput, ownerUserId: number | null): Promise<ClassRecord> {
    for (let i = 0; i < CODE_TRIES; i++) {
      try {
        const row = await this.db.one<ClassRow>(
          `INSERT INTO classes (code, name, owner_user_id, city_seed, banks_open, round_minutes, player_cap, dialect, squad_mode, squad_size, mode)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
          [
            this.makeCode(),
            input.name,
            ownerUserId,
            input.citySeed,
            JSON.stringify(input.banksOpen),
            input.roundMinutes,
            input.playerCap,
            input.dialect,
            input.squadMode,
            input.squadSize,
            input.mode,
          ],
        );
        return fromRow(row as ClassRow);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err; // a code clash: try another
      }
    }
    throw new Error('could not find a free class code');
  }

  async get(id: number): Promise<ClassRecord | undefined> {
    const row = await this.db.one<ClassRow>('SELECT * FROM classes WHERE id = $1', [id]);
    return row && fromRow(row);
  }

  async findByCode(code: string): Promise<ClassRecord | undefined> {
    const row = await this.db.one<ClassRow>('SELECT * FROM classes WHERE code = $1', [code]);
    return row && fromRow(row);
  }

  async list(
    options: { ownerUserId?: number; includeArchived?: boolean } = {},
  ): Promise<ClassRecord[]> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (options.ownerUserId !== undefined) {
      args.push(options.ownerUserId);
      where.push(`owner_user_id = $${args.length}`);
    }
    if (!options.includeArchived) where.push('NOT archived');
    const rows = await this.db.query<ClassRow>(
      `SELECT * FROM classes ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC`,
      args,
    );
    return rows.map(fromRow);
  }

  async update(id: number, changes: Partial<ClassInput>): Promise<ClassRecord | undefined> {
    const sets: string[] = [];
    const args: unknown[] = [];
    const set = (column: string, value: unknown) => {
      args.push(value);
      sets.push(`${column} = $${args.length}`);
    };
    if (changes.name !== undefined) set('name', changes.name);
    if (changes.citySeed !== undefined) set('city_seed', changes.citySeed);
    if (changes.banksOpen !== undefined) set('banks_open', JSON.stringify(changes.banksOpen));
    if (changes.roundMinutes !== undefined) set('round_minutes', changes.roundMinutes);
    if (changes.playerCap !== undefined) set('player_cap', changes.playerCap);
    if (changes.dialect !== undefined) set('dialect', changes.dialect);
    if (changes.mode !== undefined) set('mode', changes.mode);
    if (changes.squadMode !== undefined) set('squad_mode', changes.squadMode);
    if (changes.squadSize !== undefined) set('squad_size', changes.squadSize);
    if (sets.length === 0) return this.get(id);
    args.push(id);
    const row = await this.db.one<ClassRow>(
      `UPDATE classes SET ${sets.join(', ')}, updated_at = now() WHERE id = $${args.length} RETURNING *`,
      args,
    );
    return row && fromRow(row);
  }

  private async flag(id: number, column: 'locked' | 'archived', value: boolean) {
    const row = await this.db.one<ClassRow>(
      `UPDATE classes SET ${column} = $1, ${column === 'archived' ? 'archived_at = now(), ' : ''}updated_at = now() WHERE id = $2 RETURNING *`,
      [value, id],
    );
    return row && fromRow(row);
  }

  async acceptConsent(id: number, version: number, byUserId: number | null, now = new Date()) {
    const row = await this.db.one<ClassRow>(
      `UPDATE classes SET consent_version = $1, consent_user_id = $2, consent_at = $3, updated_at = now()
       WHERE id = $4 RETURNING *`,
      [version, byUserId, now, id],
    );
    return row && fromRow(row);
  }

  async deleteArchivedBefore(before: Date): Promise<number[]> {
    const rows = await this.db.query<{ id: string }>(
      'DELETE FROM classes WHERE archived AND archived_at < $1 RETURNING id',
      [before],
    );
    return rows.map((r) => Number(r.id));
  }

  setLocked(id: number, locked: boolean) {
    return this.flag(id, 'locked', locked);
  }

  archive(id: number) {
    return this.flag(id, 'archived', true);
  }

  async regenerateCode(id: number): Promise<ClassRecord | undefined> {
    for (let i = 0; i < CODE_TRIES; i++) {
      try {
        const row = await this.db.one<ClassRow>(
          'UPDATE classes SET code = $1, updated_at = now() WHERE id = $2 RETURNING *',
          [this.makeCode(), id],
        );
        return row && fromRow(row);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw new Error('could not find a free class code');
  }

  async setQuestions(id: number, links: readonly ClassQuestionLink[]): Promise<void> {
    await this.db.tx(async (tx: PgTx) => {
      const ids = [...new Set(links.map((l) => l.questionId))];
      const known = new Set(
        (
          await tx.query<{ id: string }>(
            'SELECT id FROM questions WHERE deleted_at IS NULL AND id = ANY($1::bigint[])',
            [ids],
          )
        ).map((r) => Number(r.id)),
      );
      const missing = ids.filter((q) => !known.has(q));
      if (missing.length) throw new UnknownClassQuestionsError(missing);
      await tx.query('DELETE FROM class_questions WHERE class_id = $1', [id]);
      for (const l of dedupe(links))
        await tx.query(
          'INSERT INTO class_questions (class_id, question_id, usage) VALUES ($1, $2, $3)',
          [id, l.questionId, l.usage],
        );
    });
  }

  async questions(id: number): Promise<ClassQuestionLink[]> {
    const rows = await this.db.query<{ question_id: string; usage: QuestionUsage }>(
      'SELECT question_id, usage FROM class_questions WHERE class_id = $1 ORDER BY usage, question_id',
      [id],
    );
    return rows.map((r) => ({ questionId: Number(r.question_id), usage: r.usage }));
  }

  async addMember(classId: number, playerId: number, now = new Date()): Promise<boolean> {
    const rows = await this.db.query(
      `INSERT INTO class_members (class_id, player_id, joined_at) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING player_id`,
      [classId, playerId, now],
    );
    return rows.length > 0;
  }

  async members(classId: number): Promise<ClassMember[]> {
    const rows = await this.db.query<{ player_id: string; joined_at: Date }>(
      'SELECT player_id, joined_at FROM class_members WHERE class_id = $1 ORDER BY joined_at, player_id',
      [classId],
    );
    return rows.map((r) => ({
      playerId: Number(r.player_id),
      joinedAt: r.joined_at.toISOString(),
    }));
  }

  async isMember(classId: number, playerId: number): Promise<boolean> {
    return !!(await this.db.one(
      'SELECT 1 FROM class_members WHERE class_id = $1 AND player_id = $2',
      [classId, playerId],
    ));
  }

  async squads(classId: number): Promise<Record<number, number>> {
    const rows = await this.db.query<{ player_id: string; squad: number }>(
      'SELECT player_id, squad FROM class_squads WHERE class_id = $1',
      [classId],
    );
    return Object.fromEntries(rows.map((r) => [Number(r.player_id), r.squad]));
  }

  async setSquads(classId: number, assignments: Readonly<Record<number, number>>): Promise<void> {
    await this.db.tx(async (tx) => {
      await tx.query('DELETE FROM class_squads WHERE class_id = $1', [classId]);
      for (const [playerId, squad] of Object.entries(assignments))
        // Only students of the class: anyone else is skipped, not an error.
        await tx.query(
          `INSERT INTO class_squads (class_id, player_id, squad)
           SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM class_members WHERE class_id = $1 AND player_id = $2)`,
          [classId, Number(playerId), squad],
        );
    });
  }
}

const dedupe = (links: readonly ClassQuestionLink[]): ClassQuestionLink[] => {
  const seen = new Set<string>();
  return links.filter((l) => {
    const key = `${l.questionId}:${l.usage}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
};

/** For tests and development without a database. Question ids are taken as given unless `knownQuestions` is passed. */
export class InMemoryClassRepository implements ClassRepository {
  private readonly classes = new Map<number, ClassRecord>();
  private readonly links = new Map<number, ClassQuestionLink[]>();
  private readonly joined = new Map<number, Map<number, string>>();
  private nextId = 1;

  constructor(
    private readonly makeCode: () => string = newClassCode,
    private readonly knownQuestions?: () => ReadonlySet<number>,
  ) {}

  private freshCode(): string {
    for (let i = 0; i < CODE_TRIES; i++) {
      const code = this.makeCode();
      if (![...this.classes.values()].some((c) => c.code === code)) return code;
    }
    throw new Error('could not find a free class code');
  }

  async create(input: ClassInput, ownerUserId: number | null) {
    const now = new Date().toISOString();
    const record: ClassRecord = {
      ...input,
      id: this.nextId++,
      code: this.freshCode(),
      ownerUserId,
      locked: false,
      archived: false,
      archivedAt: null,
      consent: null,
      createdAt: now,
      updatedAt: now,
    };
    this.classes.set(record.id, record);
    return record;
  }

  async get(id: number) {
    return this.classes.get(id);
  }

  async findByCode(code: string) {
    return [...this.classes.values()].find((c) => c.code === code);
  }

  async list(options: { ownerUserId?: number; includeArchived?: boolean } = {}) {
    return [...this.classes.values()]
      .filter(
        (c) =>
          (options.ownerUserId === undefined || c.ownerUserId === options.ownerUserId) &&
          (options.includeArchived || !c.archived),
      )
      .sort((a, b) => b.id - a.id);
  }

  private change(id: number, changes: Partial<ClassRecord>) {
    const current = this.classes.get(id);
    if (!current) return undefined;
    const next = { ...current, ...changes, updatedAt: new Date().toISOString() };
    this.classes.set(id, next);
    return next;
  }

  async update(id: number, changes: Partial<ClassInput>) {
    const defined = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    return this.change(id, defined as Partial<ClassRecord>);
  }

  async setLocked(id: number, locked: boolean) {
    return this.change(id, { locked });
  }

  async archive(id: number) {
    return this.change(id, { archived: true, archivedAt: new Date().toISOString() });
  }

  async acceptConsent(id: number, version: number, byUserId: number | null, now = new Date()) {
    return this.change(id, { consent: { version, byUserId, at: now.toISOString() } });
  }

  async deleteArchivedBefore(before: Date): Promise<number[]> {
    const gone = [...this.classes.values()].filter(
      (c) => c.archived && c.archivedAt !== null && new Date(c.archivedAt) < before,
    );
    for (const c of gone) {
      this.classes.delete(c.id);
      this.links.delete(c.id);
      this.joined.delete(c.id);
    }
    return gone.map((c) => c.id);
  }

  async regenerateCode(id: number) {
    return this.classes.has(id) ? this.change(id, { code: this.freshCode() }) : undefined;
  }

  async setQuestions(id: number, links: readonly ClassQuestionLink[]) {
    const known = this.knownQuestions?.();
    if (known) {
      const missing = [...new Set(links.map((l) => l.questionId))].filter((q) => !known.has(q));
      if (missing.length) throw new UnknownClassQuestionsError(missing);
    }
    this.links.set(
      id,
      dedupe(links).sort((a, b) => a.usage.localeCompare(b.usage) || a.questionId - b.questionId),
    );
  }

  async questions(id: number) {
    return [...(this.links.get(id) ?? [])];
  }

  async addMember(classId: number, playerId: number, now = new Date()) {
    const m = this.joined.get(classId) ?? new Map<number, string>();
    this.joined.set(classId, m);
    if (m.has(playerId)) return false;
    m.set(playerId, now.toISOString());
    return true;
  }

  async members(classId: number) {
    return [...(this.joined.get(classId) ?? [])]
      .map(([playerId, joinedAt]) => ({ playerId, joinedAt }))
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.playerId - b.playerId);
  }

  async isMember(classId: number, playerId: number) {
    return this.joined.get(classId)?.has(playerId) ?? false;
  }

  private readonly squadRows = new Map<number, Record<number, number>>();

  async squads(classId: number) {
    return { ...(this.squadRows.get(classId) ?? {}) };
  }

  async setSquads(classId: number, assignments: Readonly<Record<number, number>>) {
    const members = this.joined.get(classId);
    this.squadRows.set(
      classId,
      Object.fromEntries(
        Object.entries(assignments).filter(([id]) => members?.has(Number(id))),
      ) as Record<number, number>,
    );
  }
}
