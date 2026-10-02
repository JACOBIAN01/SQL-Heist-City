import type { DatabaseSync } from 'node:sqlite';
import type { AdminUser, Role } from '@heist/shared';

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
  findByEmail(email: string): StoredUser | undefined;
  findById(id: number): StoredUser | undefined;
  list(): AdminUser[];
  count(): number;
  create(user: NewUser): AdminUser;
  update(id: number, changes: UserChanges): AdminUser | undefined;
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

  findByEmail(email: string): StoredUser | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
      UserRow | undefined;
    return row && toStored(row);
  }

  findById(id: number): StoredUser | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row && toStored(row);
  }

  list(): AdminUser[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY id').all() as unknown as UserRow[];
    return rows.map((r) => toPublic(toStored(r)));
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  create(user: NewUser): AdminUser {
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
      .run(user.email.toLowerCase(), user.passwordHash, user.role);
    return toPublic(this.findById(Number(lastInsertRowid)) as StoredUser);
  }

  update(id: number, changes: UserChanges): AdminUser | undefined {
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
    const user = this.findById(id);
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
