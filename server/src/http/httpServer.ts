import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PROTOCOL_VERSION } from '@heist/shared';

export interface HttpServerDeps {
  /** Injected so tests can control uptime without waiting. */
  now: () => number;
  startedAt: number;
}

// SOLID: D (Dependency Inversion) — Why: the server takes its clock from the
// caller, so the composition root (main.ts) decides real vs fake time and
// tests stay deterministic.
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
    sendJson(res, 404, { error: { code: 'not_found', message: 'Not found' } });
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
