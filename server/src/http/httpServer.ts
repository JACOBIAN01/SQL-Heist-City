import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PROTOCOL_VERSION } from '@heist/shared';

export const INTERNAL_SECRET_HEADER = 'x-internal-secret';

export interface HttpServerDeps {
  /** Injected so tests can control uptime without waiting. */
  now: () => number;
  startedAt: number;
  /** Shared secret for /internal/* (admin → game). Unset = internal routes disabled. */
  internalSecret?: string;
  /** Called on POST /internal/reload, e.g. to drop question/settings caches. */
  onReload?: () => void;
}

// SOLID: D (Dependency Inversion) — Why: the server takes its clock and
// reload hook from the caller, so the composition root (main.ts) decides
// what "reload" means and tests stay deterministic.
export function createHttpServer(deps: HttpServerDeps): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        protocolVersion: PROTOCOL_VERSION,
        uptimeMs: deps.now() - deps.startedAt,
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/internal/reload' && deps.internalSecret) {
      if (!secretMatches(req.headers[INTERNAL_SECRET_HEADER], deps.internalSecret)) {
        sendJson(res, 403, { error: { code: 'forbidden', message: 'Bad internal secret' } });
        return;
      }
      deps.onReload?.();
      res.writeHead(204).end();
      return;
    }
    sendJson(res, 404, { error: { code: 'not_found', message: 'Not found' } });
  });
}

function secretMatches(given: string | string[] | undefined, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
