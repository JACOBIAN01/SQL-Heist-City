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

export interface AdminConfig {
  readonly secureCookies: boolean;
  readonly sessionTtlMs: number;
  readonly uiDistDir?: string;
}

export interface AdminOverrides {
  /** Tests use a fast hasher; production uses scrypt defaults. */
  readonly hasher?: PasswordHasher;
  readonly now?: () => number;
}

export interface Admin {
  readonly app: Express;
  readonly auth: AuthService;
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

  const app = createAdminApp({
    logger,
    ...(config.uiDistDir === undefined ? {} : { uiDistDir: config.uiDistDir }),
    apiMiddleware: [csrfGuard, session(auth)],
    api: [authRoutes(auth, limiter, config), userRoutes(auth)],
  });
  return { app, auth };
}
