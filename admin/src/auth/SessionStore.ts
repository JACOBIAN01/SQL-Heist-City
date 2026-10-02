import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface SessionStore {
  /** Returns the raw token for the cookie; only its hash is stored. */
  create(userId: number): string;
  userIdFor(token: string): number | undefined;
  revoke(token: string): void;
  revokeAllFor(userId: number): void;
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

  create(userId: number): string {
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(hash(token), userId, this.now() + this.ttlMs);
    // Opportunistic cleanup keeps the table small without a scheduler.
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(this.now());
    return token;
  }

  userIdFor(token: string): number | undefined {
    const row = this.db
      .prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?')
      .get(hash(token), this.now()) as { user_id: number } | undefined;
    return row?.user_id;
  }

  revoke(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
  }

  revokeAllFor(userId: number): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
