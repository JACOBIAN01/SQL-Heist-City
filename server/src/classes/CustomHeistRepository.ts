import { newShareCode, type CustomHeistSpec } from '@heist/shared';
import type { PgDatabase } from '../pg/PgDatabase';

export interface CustomHeistRecord {
  readonly id: number;
  readonly ownerUserId: number | null;
  readonly name: string;
  readonly spec: CustomHeistSpec;
  /** What another teacher types to copy it. */
  readonly shareCode: string;
}

// Pattern: Repository — Why: the admin saves a teacher's heists and the room reads them when it
// starts; PostgreSQL in production, memory in tests, one contract for both.
export interface CustomHeistRepository {
  create(ownerUserId: number | null, spec: CustomHeistSpec): Promise<CustomHeistRecord>;
  get(id: number): Promise<CustomHeistRecord | undefined>;
  byShareCode(code: string): Promise<CustomHeistRecord | undefined>;
  /** A teacher's own, or everyone's when `ownerUserId` is undefined. */
  list(ownerUserId?: number): Promise<CustomHeistRecord[]>;
  update(id: number, spec: CustomHeistSpec): Promise<CustomHeistRecord | undefined>;
  remove(id: number): Promise<boolean>;
}

type Row = {
  id: string | number;
  owner_user_id: string | number | null;
  name: string;
  spec: CustomHeistSpec;
  share_code: string;
};

const record = (r: Row): CustomHeistRecord => ({
  id: Number(r.id),
  ownerUserId: r.owner_user_id === null ? null : Number(r.owner_user_id),
  name: r.name,
  spec: r.spec,
  shareCode: r.share_code,
});

export class PgCustomHeistRepository implements CustomHeistRepository {
  constructor(private readonly db: PgDatabase) {}

  async create(ownerUserId: number | null, spec: CustomHeistSpec) {
    // A clash on the share code (rare) just tries another.
    for (let attempt = 0; attempt < 10; attempt++) {
      const rows = await this.db.query<Row>(
        `INSERT INTO custom_heists (owner_user_id, name, spec, share_code) VALUES ($1, $2, $3, $4)
         ON CONFLICT (share_code) DO NOTHING RETURNING *`,
        [ownerUserId, spec.name, JSON.stringify(spec), newShareCode()],
      );
      if (rows[0]) return record(rows[0]);
    }
    throw new Error('could not make a share code');
  }

  async get(id: number) {
    const row = await this.db.one<Row>('SELECT * FROM custom_heists WHERE id = $1', [id]);
    return row ? record(row) : undefined;
  }

  async byShareCode(code: string) {
    const row = await this.db.one<Row>('SELECT * FROM custom_heists WHERE share_code = $1', [
      code.toUpperCase(),
    ]);
    return row ? record(row) : undefined;
  }

  async list(ownerUserId?: number) {
    const rows =
      ownerUserId === undefined
        ? await this.db.query<Row>('SELECT * FROM custom_heists ORDER BY id')
        : await this.db.query<Row>(
            'SELECT * FROM custom_heists WHERE owner_user_id = $1 ORDER BY id',
            [ownerUserId],
          );
    return rows.map(record);
  }

  async update(id: number, spec: CustomHeistSpec) {
    const rows = await this.db.query<Row>(
      'UPDATE custom_heists SET name = $2, spec = $3, updated_at = now() WHERE id = $1 RETURNING *',
      [id, spec.name, JSON.stringify(spec)],
    );
    return rows[0] ? record(rows[0]) : undefined;
  }

  async remove(id: number) {
    const rows = await this.db.query('DELETE FROM custom_heists WHERE id = $1 RETURNING id', [id]);
    return rows.length > 0;
  }
}

export class InMemoryCustomHeistRepository implements CustomHeistRepository {
  private readonly rows = new Map<number, CustomHeistRecord>();
  private next = 1;

  async create(ownerUserId: number | null, spec: CustomHeistSpec) {
    let shareCode = newShareCode();
    while ([...this.rows.values()].some((r) => r.shareCode === shareCode))
      shareCode = newShareCode();
    const made = { id: this.next++, ownerUserId, name: spec.name, spec, shareCode };
    this.rows.set(made.id, made);
    return made;
  }

  async get(id: number) {
    return this.rows.get(id);
  }

  async byShareCode(code: string) {
    return [...this.rows.values()].find((r) => r.shareCode === code.toUpperCase());
  }

  async list(ownerUserId?: number) {
    return [...this.rows.values()].filter(
      (r) => ownerUserId === undefined || r.ownerUserId === ownerUserId,
    );
  }

  async update(id: number, spec: CustomHeistSpec) {
    const was = this.rows.get(id);
    if (!was) return undefined;
    const next = { ...was, name: spec.name, spec };
    this.rows.set(id, next);
    return next;
  }

  async remove(id: number) {
    return this.rows.delete(id);
  }
}
