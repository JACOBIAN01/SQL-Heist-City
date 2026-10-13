import { createHash, randomBytes } from 'node:crypto';
import type { PgDatabase } from '../pg/PgDatabase';

/** A person who signs in with Google. The only personal data kept (docs/identity.md). */
export interface Player {
  readonly id: number;
  readonly googleSub: string;
  readonly email: string;
  readonly displayName: string;
  /** The Google Workspace domain (`hd`) or the email's domain; null for a plain account. */
  readonly schoolDomain: string | null;
  readonly createdAt: string;
  readonly lastSeenAt: string;
}

export interface GoogleIdentity {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
  readonly domain: string | null;
}

// Pattern: Repository — Why: sign-in, tickets, classes and analytics all need "the player"; they
// depend on this contract, not PostgreSQL, so tests use the in-memory one.
export interface PlayerRepository {
  /** Finds the player by Google's stable id, or creates them; refreshes email and last seen. A chosen display name is kept. */
  upsertFromGoogle(identity: GoogleIdentity, now?: Date): Promise<Player>;
  findById(id: number): Promise<Player | undefined>;
  findBySub(sub: string): Promise<Player | undefined>;
  rename(id: number, displayName: string): Promise<Player | undefined>;
  /** Players whose name or email contains `q` (any case), newest first, for the staff page. */
  search(q: string, limit?: number): Promise<Player[]>;
  /** Removes the player and everything keyed to them (13.10). */
  remove(id: number): Promise<boolean>;
}

export interface PlayerSessions {
  /** The raw token for the cookie; only its hash is stored. */
  create(playerId: number): Promise<string>;
  playerIdFor(token: string): Promise<number | undefined>;
  revoke(token: string): Promise<void>;
  revokeAllFor(playerId: number): Promise<void>;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

interface PlayerRow {
  id: string | number;
  google_sub: string;
  email: string;
  display_name: string;
  school_domain: string | null;
  created_at: Date;
  last_seen_at: Date;
  [column: string]: unknown;
}

const fromRow = (r: PlayerRow): Player => ({
  id: Number(r.id),
  googleSub: r.google_sub,
  email: r.email,
  displayName: r.display_name,
  schoolDomain: r.school_domain,
  createdAt: r.created_at.toISOString(),
  lastSeenAt: r.last_seen_at.toISOString(),
});

export class PgPlayerRepository implements PlayerRepository {
  constructor(private readonly db: PgDatabase) {}

  async upsertFromGoogle(identity: GoogleIdentity, now = new Date()): Promise<Player> {
    const row = await this.db.one<PlayerRow>(
      `INSERT INTO players (google_sub, email, display_name, school_domain, created_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (google_sub) DO UPDATE
         SET email = excluded.email, school_domain = excluded.school_domain, last_seen_at = excluded.last_seen_at
       RETURNING *`,
      [identity.sub, identity.email, identity.name, identity.domain, now],
    );
    return fromRow(row as PlayerRow);
  }

  async findById(id: number): Promise<Player | undefined> {
    const row = await this.db.one<PlayerRow>('SELECT * FROM players WHERE id = $1', [id]);
    return row && fromRow(row);
  }

  async findBySub(sub: string): Promise<Player | undefined> {
    const row = await this.db.one<PlayerRow>('SELECT * FROM players WHERE google_sub = $1', [sub]);
    return row && fromRow(row);
  }

  async rename(id: number, displayName: string): Promise<Player | undefined> {
    const row = await this.db.one<PlayerRow>(
      'UPDATE players SET display_name = $1 WHERE id = $2 RETURNING *',
      [displayName, id],
    );
    return row && fromRow(row);
  }

  async search(q: string, limit = 50): Promise<Player[]> {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await this.db.query<PlayerRow>(
      `SELECT * FROM players WHERE display_name ILIKE $1 OR email ILIKE $1 ORDER BY id DESC LIMIT $2`,
      [like, Math.min(limit, 200)],
    );
    return rows.map(fromRow);
  }

  async remove(id: number): Promise<boolean> {
    return (await this.db.query('DELETE FROM players WHERE id = $1 RETURNING id', [id])).length > 0;
  }
}

export class PgPlayerSessions implements PlayerSessions {
  constructor(
    private readonly db: PgDatabase,
    private readonly ttlMs = 12 * 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  async create(playerId: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      'INSERT INTO player_sessions (token_hash, player_id, expires_at) VALUES ($1, $2, $3)',
      [hash(token), playerId, this.now() + this.ttlMs],
    );
    await this.db.query('DELETE FROM player_sessions WHERE expires_at <= $1', [this.now()]);
    return token;
  }

  async playerIdFor(token: string): Promise<number | undefined> {
    const row = await this.db.one<{ player_id: string }>(
      'SELECT player_id FROM player_sessions WHERE token_hash = $1 AND expires_at > $2',
      [hash(token), this.now()],
    );
    return row ? Number(row.player_id) : undefined;
  }

  async revoke(token: string): Promise<void> {
    await this.db.query('DELETE FROM player_sessions WHERE token_hash = $1', [hash(token)]);
  }

  async revokeAllFor(playerId: number): Promise<void> {
    await this.db.query('DELETE FROM player_sessions WHERE player_id = $1', [playerId]);
  }
}

/** For tests, and for running the game with no database at all. */
export class InMemoryPlayerRepository implements PlayerRepository {
  private readonly players = new Map<number, Player>();
  private nextId = 1;

  async upsertFromGoogle(identity: GoogleIdentity, now = new Date()): Promise<Player> {
    const existing = [...this.players.values()].find((p) => p.googleSub === identity.sub);
    const player: Player = existing
      ? {
          ...existing,
          email: identity.email,
          schoolDomain: identity.domain,
          lastSeenAt: now.toISOString(),
        }
      : {
          id: this.nextId++,
          googleSub: identity.sub,
          email: identity.email,
          displayName: identity.name,
          schoolDomain: identity.domain,
          createdAt: now.toISOString(),
          lastSeenAt: now.toISOString(),
        };
    this.players.set(player.id, player);
    return player;
  }

  async findById(id: number) {
    return this.players.get(id);
  }

  async findBySub(sub: string) {
    return [...this.players.values()].find((p) => p.googleSub === sub);
  }

  async rename(id: number, displayName: string) {
    const p = this.players.get(id);
    if (!p) return undefined;
    const next = { ...p, displayName };
    this.players.set(id, next);
    return next;
  }

  async search(q: string, limit = 50) {
    const needle = q.toLowerCase();
    return [...this.players.values()]
      .filter(
        (p) =>
          p.displayName.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.id - a.id)
      .slice(0, Math.min(limit, 200));
  }

  async remove(id: number) {
    return this.players.delete(id);
  }
}

export class InMemoryPlayerSessions implements PlayerSessions {
  private readonly sessions = new Map<string, { playerId: number; expiresAt: number }>();

  constructor(
    private readonly ttlMs = 12 * 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  async create(playerId: number) {
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(hash(token), { playerId, expiresAt: this.now() + this.ttlMs });
    return token;
  }

  async playerIdFor(token: string) {
    const s = this.sessions.get(hash(token));
    return s && s.expiresAt > this.now() ? s.playerId : undefined;
  }

  async revoke(token: string) {
    this.sessions.delete(hash(token));
  }

  async revokeAllFor(playerId: number) {
    for (const [k, v] of this.sessions) if (v.playerId === playerId) this.sessions.delete(k);
  }
}
