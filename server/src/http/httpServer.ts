import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PROTOCOL_VERSION } from '@heist/shared';
import { OriginPolicy } from '../net/OriginPolicy';

export const INTERNAL_SECRET_HEADER = 'x-internal-secret';

export interface HttpServerDeps {
  /** Injected so tests can control uptime without waiting. */
  now: () => number;
  startedAt: number;
  /** Shared secret for /internal/* (admin → game). Unset = internal routes disabled. */
  internalSecret?: string;
  /** Source for `GET /lobby`: which matches exist and where to connect. Absent = route disabled. */
  lobby?: () => unknown;
  /** Source of numbers for `GET /metrics` (tick time, players, bandwidth). Absent = route disabled. */
  metrics?: () => unknown;
  /** Class rooms: `GET /class/:id` (public status) and `POST /internal/class/:id` (the admin's live controls). */
  classRooms?: {
    status(classId: number): unknown;
    handle(classId: number, body: unknown): Promise<unknown>;
  };
  /** Called on POST /internal/reload, e.g. to drop question/settings caches. */
  onReload?: () => void | Promise<void>;
  /** Which pages may read the lobby and class status (default: from the environment). */
  origins?: OriginPolicy;
}

// SOLID: D (Dependency Inversion) — Why: the server takes its clock and
// reload hook from the caller, so the composition root (main.ts) decides
// what "reload" means and tests stay deterministic.
export function createHttpServer(deps: HttpServerDeps): Server {
  const origins = deps.origins ?? OriginPolicy.fromEnv(process.env);
  /**
   * The public reads (lobby, class status) answer the game's own pages only: another site gets
   * 403, and an allowed one gets its origin back (never `*`).
   */
  const crossOrigin = (req: IncomingMessage, res: ServerResponse): boolean => {
    const origin = req.headers.origin;
    if (!origins.allows(origin, req.headers.host)) {
      sendJson(res, 403, { error: { code: 'origin', message: 'Not from the game' } });
      return false;
    }
    if (origin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
    }
    return true;
  };
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        protocolVersion: PROTOCOL_VERSION,
        uptimeMs: deps.now() - deps.startedAt,
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/lobby' && deps.lobby) {
      // The game page may be served from another origin (the Vite dev server, a CDN).
      if (crossOrigin(req, res)) sendJson(res, 200, deps.lobby());
      return;
    }
    if (req.method === 'GET' && req.url === '/metrics' && deps.metrics) {
      sendJson(res, 200, deps.metrics());
      return;
    }
    if (req.method === 'POST' && req.url === '/internal/reload' && deps.internalSecret) {
      if (!secretMatches(req.headers[INTERNAL_SECRET_HEADER], deps.internalSecret)) {
        sendJson(res, 403, { error: { code: 'forbidden', message: 'Bad internal secret' } });
        return;
      }
      void Promise.resolve(deps.onReload?.()).then(
        () => res.writeHead(204).end(),
        () => sendJson(res, 500, { error: { code: 'reload_failed', message: 'Reload failed' } }),
      );
      return;
    }
    const publicRoom = /^\/class\/(\d{1,9})$/.exec(req.url ?? '');
    if (req.method === 'GET' && publicRoom && deps.classRooms) {
      if (crossOrigin(req, res)) sendJson(res, 200, deps.classRooms.status(Number(publicRoom[1])));
      return;
    }
    const control = /^\/internal\/class\/(\d{1,9})$/.exec(req.url ?? '');
    if (req.method === 'POST' && control && deps.classRooms && deps.internalSecret) {
      if (!secretMatches(req.headers[INTERNAL_SECRET_HEADER], deps.internalSecret)) {
        sendJson(res, 403, { error: { code: 'forbidden', message: 'Bad internal secret' } });
        return;
      }
      const rooms = deps.classRooms;
      void readBody(req).then(
        (body) =>
          rooms.handle(Number(control[1]), body).then(
            (result) => sendJson(res, 200, result),
            () => sendJson(res, 500, { error: { code: 'failed', message: 'Class room error' } }),
          ),
        () => sendJson(res, 400, { error: { code: 'bad_body', message: 'Bad request body' } }),
      );
      return;
    }
    if (req.method === 'OPTIONS' && (publicRoom || req.url === '/lobby')) {
      if (crossOrigin(req, res)) res.writeHead(204).end();
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

/** A small JSON body (internal calls only); anything bigger is refused. */
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let text = '';
    req.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
      if (text.length > 4096) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}
