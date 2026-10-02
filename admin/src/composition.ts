import type { DatabaseSync } from 'node:sqlite';
import type { Express } from 'express';
import { AuthService } from './auth/AuthService';
import { LoginRateLimiter } from './auth/LoginRateLimiter';
import { csrfGuard, session } from './auth/middleware';
import { ScryptPasswordHasher, type PasswordHasher } from './auth/PasswordHasher';
import { authRoutes } from './auth/routes';
import { SqliteSessionStore } from './auth/SessionStore';
import { SqliteUserRepository } from './auth/UserRepository';
import { createAdminApp } from './http/app';
import type { ErrorLogger } from './http/errors';
import { userRoutes } from './users/routes';
import { SqliteQuestionRepository } from '@heist/server/questions/SqliteQuestionRepository';
import { AdminEventBus } from './events/AdminEvents';
import { SqliteAuditLog, auditAdminEvents } from './audit/AuditLog';
import { auditRoutes } from './audit/routes';
import { QuestionAdminService } from './questions/QuestionAdminService';
import { questionRoutes } from './questions/routes';
import { QuestionTester } from './questions/QuestionTester';
import { Grader } from '@heist/server/sql/Grader';
import type { SandboxRunner } from '@heist/server/sql/SandboxRunner';
import { WorkerSandboxRunner } from '@heist/server/sql/WorkerSandboxRunner';
import { builtInDatasets } from '@heist/server/variants/datasets';
import { VariantBuilder } from '@heist/server/variants/VariantBuilder';

export interface AdminConfig {
  readonly secureCookies: boolean;
  readonly sessionTtlMs: number;
  readonly uiDistDir?: string;
}

export interface AdminOverrides {
  /** Tests use a fast hasher; production uses scrypt defaults. */
  readonly hasher?: PasswordHasher;
  readonly now?: () => number;
  /** Tests run SQL in-process; production isolates it in worker threads. */
  readonly sandbox?: SandboxRunner;
}

export interface Admin {
  readonly app: Express;
  readonly auth: AuthService;
  readonly events: AdminEventBus;
  /** Release worker threads on shutdown. */
  close(): Promise<void>;
}

/**
 * Composition root for the admin service: builds every repository and
 * service from one database handle. main.ts and integration tests both use it,
 * so tests exercise the real wiring.
 */
export function buildAdmin(
  db: DatabaseSync,
  config: AdminConfig,
  logger: ErrorLogger,
  overrides: AdminOverrides = {},
): Admin {
  const now = overrides.now ?? Date.now;
  const users = new SqliteUserRepository(db);
  const sessions = new SqliteSessionStore(db, config.sessionTtlMs, now);
  const auth = new AuthService(users, sessions, overrides.hasher ?? new ScryptPasswordHasher());
  const limiter = new LoginRateLimiter(5, 15 * 60 * 1000, now);
  const events = new AdminEventBus();
  const audit = new SqliteAuditLog(db);
  auditAdminEvents(events, audit);
  const questions = new QuestionAdminService(new SqliteQuestionRepository(db), events);
  const sandbox = overrides.sandbox ?? new WorkerSandboxRunner({ size: 2 });
  const tester = new QuestionTester(new VariantBuilder(builtInDatasets), new Grader(sandbox));

  const app = createAdminApp({
    logger,
    ...(config.uiDistDir === undefined ? {} : { uiDistDir: config.uiDistDir }),
    apiMiddleware: [csrfGuard, session(auth)],
    api: [
      authRoutes(auth, limiter, config),
      userRoutes(auth, events),
      questionRoutes(questions, tester),
      auditRoutes(audit),
    ],
  });
  return { app, auth, events, close: () => sandbox.close() };
}
