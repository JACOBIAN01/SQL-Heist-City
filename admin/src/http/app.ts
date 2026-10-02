import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express, type RequestHandler, type Router } from 'express';
import { PROTOCOL_VERSION } from '@heist/shared';
import { apiNotFound, errorHandler, type ErrorLogger } from './errors';

export interface AdminAppDeps {
  readonly logger: ErrorLogger;
  /** Runs before every /api route (session, CSRF guard). */
  readonly apiMiddleware?: readonly RequestHandler[];
  /** Feature routers mounted under /api (auth, questions, …), built in main.ts. */
  readonly api?: readonly Router[];
  /** Built React UI to serve; skipped when the folder doesn't exist (in dev, Vite serves it). */
  readonly uiDistDir?: string;
}

// SOLID: D (Dependency Inversion) — Why: the app is assembled from injected
// routers and options instead of creating services itself, so tests build it
// with in-memory pieces and main.ts stays the one place that knows the
// environment.
export function createAdminApp(deps: AdminAppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '5mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'admin', protocolVersion: PROTOCOL_VERSION });
  });

  const api = express.Router();
  for (const middleware of deps.apiMiddleware ?? []) api.use(middleware);
  for (const router of deps.api ?? []) api.use(router);
  api.use(apiNotFound);
  app.use('/api', api);

  if (deps.uiDistDir && existsSync(deps.uiDistDir)) {
    const dir = deps.uiDistDir;
    app.use(express.static(dir));
    // Client-side routes (e.g. /questions/12) all load the SPA.
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dir, 'index.html')));
  }

  app.use(errorHandler(deps.logger));
  return app;
}
