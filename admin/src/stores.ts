import type { DatabaseSync } from 'node:sqlite';
import type { SettingsStore } from '@heist/server/config/SettingsStore';
import { PgSettingsStore, SqliteSettingsStore } from '@heist/server/config/SettingsStore';
import type { PgDatabase } from '@heist/server/pg/PgDatabase';
import { PgQuestionStore } from '@heist/server/questions/PgQuestionStore';
import { SqliteQuestionRepository } from '@heist/server/questions/SqliteQuestionRepository';
import { SyncQuestionStore, type QuestionStore } from '@heist/server/questions/QuestionStore';
import {
  InMemoryClassRepository,
  PgClassRepository,
  type ClassRepository,
} from '@heist/server/classes/ClassRepository';
import {
  InMemoryPlayerRepository,
  InMemoryPlayerSessions,
  PgPlayerRepository,
  PgPlayerSessions,
  type PlayerRepository,
  type PlayerSessions,
} from '@heist/server/players/PlayerRepository';
import { PgAuditLog, SqliteAuditLog, type AuditLog } from './audit/AuditLog';
import { PgSessionStore, SqliteSessionStore, type SessionStore } from './auth/SessionStore';
import { PgUserRepository, SqliteUserRepository, type UserRepository } from './auth/UserRepository';
import {
  PgPoolRepository,
  SqlitePoolRepository,
  type PoolRepository,
} from './pools/PoolRepository';

/**
 * Everything the admin persists, behind async interfaces.
 *
 * Pattern: Abstract Factory — Why: the admin is wired to one family of stores
 * (all SQLite for development and fast tests, all PostgreSQL in production),
 * so a service can never end up half on one database and half on the other.
 */
export interface AdminStores {
  readonly questions: QuestionStore;
  readonly users: UserRepository;
  readonly audit: AuditLog;
  readonly pools: PoolRepository;
  readonly settings: SettingsStore;
  /** Players who sign in with Google. SQLite development keeps them in memory only. */
  readonly players: PlayerRepository;
  /** Teachers' classes, their question sets and rosters. SQLite development keeps them in memory only. */
  readonly classes: ClassRepository;
  playerSessions(ttlMs: number, now: () => number): PlayerSessions;
  sessions(ttlMs: number, now: () => number): SessionStore;
}

export function sqliteStores(db: DatabaseSync): AdminStores {
  const questionRepo = new SqliteQuestionRepository(db);
  return {
    questions: new SyncQuestionStore(questionRepo),
    users: new SqliteUserRepository(db),
    audit: new SqliteAuditLog(db),
    pools: new SqlitePoolRepository(db),
    settings: new SqliteSettingsStore(db),
    players: new InMemoryPlayerRepository(),
    classes: new InMemoryClassRepository(
      undefined,
      () => new Set(questionRepo.list().map((q) => q.id)),
    ),
    playerSessions: (ttl, now) => new InMemoryPlayerSessions(ttl, now),
    sessions: (ttl, now) => new SqliteSessionStore(db, ttl, now),
  };
}

export function pgStores(db: PgDatabase): AdminStores {
  return {
    questions: new PgQuestionStore(db),
    users: new PgUserRepository(db),
    audit: new PgAuditLog(db),
    pools: new PgPoolRepository(db),
    settings: new PgSettingsStore(db),
    players: new PgPlayerRepository(db),
    classes: new PgClassRepository(db),
    playerSessions: (ttl, now) => new PgPlayerSessions(db, ttl, now),
    sessions: (ttl, now) => new PgSessionStore(db, ttl, now),
  };
}
