import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { upgradeRouterFor } from './UpgradeRouter';

let http: Server;
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await new Promise((resolve) => http.close(resolve));
});

const open = (port: number, path: string) =>
  new Promise<string>((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}${path}`);
    sockets.push(ws);
    ws.on('message', (data) => resolve(data.toString()));
    ws.on('error', () => resolve('refused'));
  });

describe('UpgradeRouter', () => {
  it('serves several endpoints on one HTTP server and refuses unknown paths', async () => {
    http = createServer();
    const router = upgradeRouterFor(http);
    for (const name of ['a', 'b']) {
      const wss = new WebSocketServer({ noServer: true });
      wss.on('connection', (ws) => ws.send(name));
      router.route(`/ws/${name}`, wss);
    }
    await new Promise<void>((resolve) => http.listen(0, resolve));
    const { port } = http.address() as AddressInfo;
    expect(await open(port, '/ws/a')).toBe('a');
    expect(await open(port, '/ws/b')).toBe('b');
    expect(await open(port, '/ws/nope')).toBe('refused');
  });

  it('reuses one router per server and rejects a duplicate path', () => {
    http = createServer();
    expect(upgradeRouterFor(http)).toBe(upgradeRouterFor(http));
    upgradeRouterFor(http).route('/x', new WebSocketServer({ noServer: true }));
    expect(() =>
      upgradeRouterFor(http).route('/x', new WebSocketServer({ noServer: true })),
    ).toThrow();
  });
});
