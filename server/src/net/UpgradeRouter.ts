import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebSocketServer } from 'ws';

/**
 * Sends each WebSocket upgrade to the endpoint registered for its path.
 * `ws` servers attached directly to one HTTP server with different `path`
 * options abort each other's handshakes, so endpoints register here instead.
 */
export class UpgradeRouter {
  private readonly routes = new Map<string, WebSocketServer>();

  constructor(http: Server) {
    http.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      const target = this.routes.get(path);
      if (!target) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      target.handleUpgrade(request, socket, head, (ws) => target.emit('connection', ws, request));
    });
  }

  route(path: string, wss: WebSocketServer): void {
    if (this.routes.has(path)) throw new Error(`websocket path already routed: ${path}`);
    this.routes.set(path, wss);
  }
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
