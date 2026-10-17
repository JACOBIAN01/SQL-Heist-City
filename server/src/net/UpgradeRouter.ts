import type { IncomingMessage, Server } from 'node:http';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import type { WebSocketServer } from 'ws';
import { rateLimitsFrom } from '@heist/shared';
import { clientAddress } from './clientAddress';
import { KeyedLimiter } from './KeyedLimiter';
import { OriginPolicy } from './OriginPolicy';

/**
 * Sends each WebSocket upgrade to the endpoint registered for its path.
 * `ws` servers attached directly to one HTTP server with different `path`
 * options abort each other's handshakes, so endpoints register here instead.
 */
export class UpgradeRouter {
  private readonly routes = new Map<string, WebSocketServer>();
  /** Which local ports may be reached through `/at/<port>/…` (the worker matches); none by default. */
  private relayAllowed: (port: number) => boolean = () => false;

  constructor(
    http: Server,
    /** Which pages may connect; replaceable for tests. */
    public origins: OriginPolicy = OriginPolicy.fromEnv(process.env),
    /** New connections per client address (Phase 18.2); replaceable for tests. */
    public connections: KeyedLimiter = new KeyedLimiter(
      rateLimitsFrom(process.env.RATE_LIMITS).connectionsPerIp,
    ),
  ) {
    http.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!this.origins.allows(request.headers.origin, request.headers.host)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      if (!this.connections.take(clientAddress(request))) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const url = new URL(request.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const relay = /^\/at\/(\d{2,5})(\/ws\/[a-z]+)$/.exec(path);
      if (relay) {
        const port = Number(relay[1]);
        if (!this.relayAllowed(port)) {
          socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        relayUpgrade(port, `${relay[2]}${url.search}`, request, socket, head);
        return;
      }
      const target = this.routes.get(path);
      if (!target) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      target.handleUpgrade(request, socket, head, (ws) => target.emit('connection', ws, request));
    });
  }

  /**
   * A match on a worker thread listens on a port of its own, which a TLS proxy in front of this
   * server cannot expose. This server relays `/at/<port>/ws/game` to it instead, so the whole
   * game is reachable through one address (Phase 20.6). Only ports `allowed` says are matches.
   */
  allowRelay(allowed: (port: number) => boolean): void {
    this.relayAllowed = allowed;
  }

  route(path: string, wss: WebSocketServer): void {
    if (this.routes.has(path)) throw new Error(`websocket path already routed: ${path}`);
    this.routes.set(path, wss);
  }
}

/**
 * Passes one WebSocket upgrade on to 127.0.0.1:`port` and then the bytes both ways. The request
 * goes on as it came (the match checks the origin itself) with the client's address added, so
 * limits there count the student rather than this relay.
 */
function relayUpgrade(
  port: number,
  path: string,
  request: IncomingMessage,
  client: Duplex,
  head: Buffer,
): void {
  const upstream = connect(port, '127.0.0.1');
  const fail = () => {
    client.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    client.destroy();
  };
  upstream.once('error', fail);
  upstream.once('connect', () => {
    upstream.off('error', fail);
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
    const lines = [`${request.method} ${path} HTTP/1.1`];
    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      const name = request.rawHeaders[i] as string;
      if (name.toLowerCase() !== 'x-forwarded-for')
        lines.push(`${name}: ${request.rawHeaders[i + 1]}`);
    }
    lines.push(`X-Forwarded-For: ${clientAddress(request)}`, '', '');
    upstream.write(lines.join('\r\n'));
    if (head.length > 0) upstream.write(head);
    client.pipe(upstream);
    upstream.pipe(client);
  });
}

const routers = new WeakMap<Server, UpgradeRouter>();

/** One router per HTTP server, however many endpoints attach to it. */
export function upgradeRouterFor(http: Server): UpgradeRouter {
  let router = routers.get(http);
  if (!router) {
    router = new UpgradeRouter(http);
    routers.set(http, router);
  }
  return router;
}
