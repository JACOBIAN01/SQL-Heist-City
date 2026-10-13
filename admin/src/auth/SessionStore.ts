import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { PgDatabase } from '@heist/server/pg/PgDatabase';

export interface SessionStore {
  /** Returns the raw token for the cookie; only its hash is stored. */
  create(userId: number): Promise<string>;
  userIdFor(token: string): Promise<number | undefined>;
  revoke(token: string): Promise<void>;
  revokeAllFor(userId: number): Promise<void>;
}

/**
 * Opaque random session tokens. The DB keeps only SHA-256 of each token, so
 * a leaked database backup can't be used to hijack sessions.
 */
export class SqliteSessionStore implements SessionStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly ttlMs = 12 * 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  async create(userId: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(hash(token), userId, this.now() + this.ttlMs);
    // Opportunistic cleanup keeps the table small without a scheduler.
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(this.now());
    return token;
  }

  async userIdFor(token: string): Promise<number | undefined> {
    const row = this.db
      .prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?')
      .get(hash(token), this.now()) as { user_id: number } | undefined;
    return row?.user_id;
  }

  async revoke(token: string): Promise<void> {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
  }

  async revokeAllFor(userId: number): Promise<void> {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

/** Sessions on PostgreSQL. */
export class PgSessionStore implements SessionStore {
  constructor(
    private readonly db: PgDatabase,
    private readonly ttlMs = 12 * 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  async create(userId: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [hash(token), userId, this.now() + this.ttlMs],
    );
    await this.db.query('DELETE FROM sessions WHERE expires_at <= $1', [this.now()]);
    return token;
  }

  async userIdFor(token: string): Promise<number | undefined> {
    const row = await this.db.one<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > $2',
      [hash(token), this.now()],
    );
    return row ? Number(row.user_id) : undefined;
  }

  async revoke(token: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE token_hash = $1', [hash(token)]);
  }

  async revokeAllFor(userId: number): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
