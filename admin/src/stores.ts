import {
  InMemoryProgressStore,
  PgProgressStore,
  type ProgressStore,
} from '@heist/server/progress/ProgressStore';
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
  InMemoryAttemptStore,
  InMemoryProfileStore,
  PgAttemptStore,
  PgProfileStore,
  type AttemptStore,
  type ProfileStore,
} from '@heist/server/analytics/AttemptStore';
import {
  PgConceptStore,
  SqliteConceptStore,
  type ConceptStore,
} from '@heist/server/concepts/ConceptStore';
import {
  InMemoryAssessmentStore,
  PgAssessmentStore,
  type AssessmentStore,
} from '@heist/server/classes/AssessmentStore';
import {
  InMemoryClassResults,
  PgClassResults,
  type ClassResultRepository,
} from '@heist/server/classes/ClassResults';
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

import {
  InMemoryPlayerSettingsStore,
  PgPlayerSettingsStore,
  type PlayerSettingsStore,
} from '@heist/server/players/PlayerSettingsStore';
import {
  InMemoryBriefStore,
  PgBriefStore,
  type BriefStore,
} from '@heist/server/analytics/BriefStore';
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
  /** Finished rounds of classes (written by the game server). */
  readonly classResults: ClassResultRepository;
  /** The learning record (written by the game server). */
  readonly concepts: ConceptStore;
  readonly assessments: AssessmentStore;
  readonly attempts: AttemptStore;
  readonly profiles: ProfileStore;
  /** Open briefs handed in from the game, and their marks. */
  readonly briefs: BriefStore;
  /** Each player's own settings (keys, sensitivity, accessibility). */
  readonly playerSettings: PlayerSettingsStore;
  readonly progress: ProgressStore;
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
    classResults: new InMemoryClassResults(),
    concepts: new SqliteConceptStore(db),
    assessments: new InMemoryAssessmentStore(),
    attempts: new InMemoryAttemptStore(),
    profiles: new InMemoryProfileStore(),
    briefs: new InMemoryBriefStore(),
    playerSettings: new InMemoryPlayerSettingsStore(),
    progress: new InMemoryProgressStore(),
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
    classResults: new PgClassResults(db),
    concepts: new PgConceptStore(db),
    assessments: new PgAssessmentStore(db),
    attempts: new PgAttemptStore(db),
    profiles: new PgProfileStore(db),
    briefs: new PgBriefStore(db),
    playerSettings: new PgPlayerSettingsStore(db),
    progress: new PgProgressStore(db),
    playerSessions: (ttl, now) => new PgPlayerSessions(db, ttl, now),
    sessions: (ttl, now) => new PgSessionStore(db, ttl, now),
  };
}
