import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { OriginPolicy } from './OriginPolicy';
import { upgradeRouterFor } from './UpgradeRouter';

describe('OriginPolicy (18.1)', () => {
  it('allows listed origins, the same origin, no origin, and localhost only in development', () => {
    const prod = OriginPolicy.fromEnv({
      NODE_ENV: 'production',
      GAME_ORIGINS: 'https://heist.school.test/, https://play.school.test',
    });
    expect(prod.allows('https://heist.school.test', 'game.school.test')).toBe(true);
    expect(prod.allows('https://play.school.test', undefined)).toBe(true);
    expect(prod.allows('https://game.school.test', 'game.school.test')).toBe(true);
    expect(prod.allows(undefined, 'game.school.test')).toBe(true);
    expect(prod.allows('https://evil.test', 'game.school.test')).toBe(false);
    expect(prod.allows('http://localhost:5173', 'game.school.test')).toBe(false);
    expect(prod.allows('null', 'game.school.test')).toBe(false);
    const dev = OriginPolicy.fromEnv({});
    expect(dev.allows('http://localhost:5173', 'localhost:8080')).toBe(true);
    expect(dev.allows('http://127.0.0.1:4173', 'localhost:8080')).toBe(true);
    expect(dev.allows('https://evil.test', 'localhost:8080')).toBe(false);
  });
});

describe('UpgradeRouter origin check', () => {
  const http = createServer();
  afterEach(() => new Promise<void>((done) => http.close(() => done())));

  it('refuses a socket from another site before any endpoint sees it', async () => {
    const router = upgradeRouterFor(http);
    router.origins = new OriginPolicy(['https://heist.school.test'], false);
    const wss = new WebSocketServer({ noServer: true });
    let connected = 0;
    wss.on('connection', (ws) => {
      connected++;
      ws.close();
    });
    router.route('/ws/test', wss);
    await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
    const { port } = http.address() as AddressInfo;
    const open = (origin: string) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/test`, { origin });
        ws.on('open', () => resolve('open'));
        ws.on('unexpected-response', (_req, res) => resolve(String(res.statusCode)));
        ws.on('error', () => resolve('error'));
      });
    expect(await open('https://evil.test')).toBe('403');
    expect(await open('https://heist.school.test')).toBe('open');
    expect(connected).toBe(1);
    wss.close();
  });
});
