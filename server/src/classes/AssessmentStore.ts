import type { PgDatabase } from '../pg/PgDatabase';

export type AssessmentKind = 'pre' | 'post';

/** A short fixed test a class takes before (pre) or after (post) a unit (Phase 16.10). */
export interface Assessment {
  readonly id: number;
  readonly classId: number;
  readonly kind: AssessmentKind;
  /** The questions, in the order students meet them. */
  readonly questionIds: readonly number[];
  /** Students can take it only while it is open. */
  readonly open: boolean;
}

// Pattern: Repository — Why: the admin sets assessments up and the game server serves them;
// both use this contract (PostgreSQL in production, memory in tests).
export interface AssessmentStore {
  get(classId: number, kind: AssessmentKind): Promise<Assessment | undefined>;
  /** Creates or replaces the class's assessment of that kind. */
  save(
    classId: number,
    kind: AssessmentKind,
    questionIds: readonly number[],
    open: boolean,
  ): Promise<Assessment>;
}

export class InMemoryAssessmentStore implements AssessmentStore {
  private readonly rows = new Map<string, Assessment>();
  private nextId = 1;

  async get(classId: number, kind: AssessmentKind) {
    return this.rows.get(`${classId}|${kind}`);
  }

  async save(classId: number, kind: AssessmentKind, questionIds: readonly number[], open: boolean) {
    const key = `${classId}|${kind}`;
    const a: Assessment = {
      id: this.rows.get(key)?.id ?? this.nextId++,
      classId,
      kind,
      questionIds: [...questionIds],
      open,
    };
    this.rows.set(key, a);
    return a;
  }
}

interface Row {
  id: string;
  class_id: string;
  kind: AssessmentKind;
  question_ids: number[];
  open: boolean;
  [column: string]: unknown;
}

const fromRow = (r: Row): Assessment => ({
  id: Number(r.id),
  classId: Number(r.class_id),
  kind: r.kind,
  questionIds: r.question_ids,
  open: r.open,
});

export class PgAssessmentStore implements AssessmentStore {
  constructor(private readonly db: PgDatabase) {}

  async get(classId: number, kind: AssessmentKind) {
    const row = await this.db.one<Row>(
      'SELECT * FROM assessments WHERE class_id = $1 AND kind = $2',
      [classId, kind],
    );
    return row && fromRow(row);
  }

  async save(classId: number, kind: AssessmentKind, questionIds: readonly number[], open: boolean) {
    const row = await this.db.one<Row>(
      `INSERT INTO assessments (class_id, kind, question_ids, open) VALUES ($1, $2, $3, $4)
       ON CONFLICT (class_id, kind) DO UPDATE SET question_ids = excluded.question_ids, open = excluded.open
       RETURNING *`,
      [classId, kind, JSON.stringify(questionIds), open],
    );
    return fromRow(row as Row);
  }
}
