import type { DatabaseSync } from 'node:sqlite';
import type { AdminUser, Role } from '@heist/shared';
import { isUniqueViolation, type PgDatabase } from '@heist/server/pg/PgDatabase';

export interface StoredUser extends AdminUser {
  readonly passwordHash: string;
}

export interface NewUser {
  readonly email: string;
  readonly passwordHash: string;
  readonly role: Role;
}

export interface UserChanges {
  readonly role?: Role;
  readonly disabled?: boolean;
  readonly passwordHash?: string;
}

// Pattern: Repository — Why: auth and user-management code talk to this
// interface, not SQL, so they are testable and storage can change in one place.
export interface UserRepository {
  findByEmail(email: string): Promise<StoredUser | undefined>;
  findById(id: number): Promise<StoredUser | undefined>;
  list(): Promise<AdminUser[]>;
  count(): Promise<number>;
  create(user: NewUser): Promise<AdminUser>;
  update(id: number, changes: UserChanges): Promise<AdminUser | undefined>;
}

/** An email already has an account. */
export class DuplicateEmailError extends Error {
  constructor(readonly email: string) {
    super(`an account for ${email} already exists`);
    this.name = 'DuplicateEmailError';
  }
}

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  role: Role;
  disabled: number;
  created_at: string;
}

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: DatabaseSync) {}

  async findByEmail(email: string): Promise<StoredUser | undefined> {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
      UserRow | undefined;
    return row && toStored(row);
  }

  async findById(id: number): Promise<StoredUser | undefined> {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row && toStored(row);
  }

  async list(): Promise<AdminUser[]> {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY id').all() as unknown as UserRow[];
    return rows.map((r) => toPublic(toStored(r)));
  }

  async count(): Promise<number> {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  async create(user: NewUser): Promise<AdminUser> {
    let id: number;
    try {
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
        .run(user.email.toLowerCase(), user.passwordHash, user.role);
      id = Number(lastInsertRowid);
    } catch (err) {
      if (/UNIQUE/.test((err as Error).message)) throw new DuplicateEmailError(user.email);
      throw err;
    }
    return toPublic((await this.findById(id)) as StoredUser);
  }

  async update(id: number, changes: UserChanges): Promise<AdminUser | undefined> {
    const sets: string[] = [];
    const args: (string | number)[] = [];
    const set = (column: string, value: string | number) => {
      sets.push(`${column} = ?`);
      args.push(value);
    };
    if (changes.role !== undefined) set('role', changes.role);
    if (changes.disabled !== undefined) set('disabled', changes.disabled ? 1 : 0);
    if (changes.passwordHash !== undefined) set('password_hash', changes.passwordHash);
    if (sets.length > 0)
      this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    const user = await this.findById(id);
    return user && toPublic(user);
  }
}

function toStored(row: UserRow): StoredUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    disabled: row.disabled === 1,
    createdAt: row.created_at,
    passwordHash: row.password_hash,
  };
}

export function toPublic(user: StoredUser): AdminUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    disabled: user.disabled,
    createdAt: user.createdAt,
  };
}

interface PgUserRow {
  id: string | number;
  email: string;
  password_hash: string;
  role: Role;
  disabled: boolean;
  created_at: Date;
  [column: string]: unknown;
}

const fromPg = (row: PgUserRow): StoredUser => ({
  id: Number(row.id),
  email: row.email,
  role: row.role,
  disabled: row.disabled,
  createdAt: row.created_at.toISOString(),
  passwordHash: row.password_hash,
});

/** The same user store on PostgreSQL (emails compare without regard to case). */
export class PgUserRepository implements UserRepository {
  constructor(private readonly db: PgDatabase) {}

  async findByEmail(email: string): Promise<StoredUser | undefined> {
    const row = await this.db.one<PgUserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [
      email,
    ]);
    return row && fromPg(row);
  }

  async findById(id: number): Promise<StoredUser | undefined> {
    const row = await this.db.one<PgUserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return row && fromPg(row);
  }

  async list(): Promise<AdminUser[]> {
    const rows = await this.db.query<PgUserRow>('SELECT * FROM users ORDER BY id');
    return rows.map((r) => toPublic(fromPg(r)));
  }

  async count(): Promise<number> {
    const row = await this.db.one<{ n: string }>('SELECT count(*) AS n FROM users');
    return Number(row?.n ?? 0);
  }

  async create(user: NewUser): Promise<AdminUser> {
    try {
      const row = await this.db.one<PgUserRow>(
        'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING *',
        [user.email.toLowerCase(), user.passwordHash, user.role],
      );
      return toPublic(fromPg(row as PgUserRow));
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateEmailError(user.email);
      throw err;
    }
  }

  async update(id: number, changes: UserChanges): Promise<AdminUser | undefined> {
    const sets: string[] = [];
    const args: unknown[] = [];
    const set = (column: string, value: unknown) => {
      args.push(value);
      sets.push(`${column} = $${args.length}`);
    };
    if (changes.role !== undefined) set('role', changes.role);
    if (changes.disabled !== undefined) set('disabled', changes.disabled);
    if (changes.passwordHash !== undefined) set('password_hash', changes.passwordHash);
    if (sets.length > 0) {
      args.push(id);
      await this.db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${args.length}`, args);
    }
    const user = await this.findById(id);
    return user && toPublic(user);
  }
}
