import { existsSync } from 'node:fs';
import express, { type Express } from 'express';
import { PROTOCOL_VERSION } from '@heist/shared';

export interface AdminAppDeps {
  /** Built React UI to serve; skipped when the folder doesn't exist (e.g. in dev, where Vite serves it). */
  uiDistDir?: string;
}

// SOLID: D (Dependency Inversion) — Why: the app is built from injected
// options instead of reading env/filesystem paths itself, so tests can create
// it in isolation and main.ts stays the single place that knows the environment.
export function createAdminApp(deps: AdminAppDeps = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'admin', protocolVersion: PROTOCOL_VERSION });
  });

  if (deps.uiDistDir && existsSync(deps.uiDistDir)) {
    app.use(express.static(deps.uiDistDir));
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
  });

  return app;
}
