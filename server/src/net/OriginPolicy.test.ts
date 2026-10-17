import { createServer, type Server } from 'node:http';
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

describe('relaying to worker matches (20.6)', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((d) => s.close(() => d()))));
  });
  const listen = async (s: Server) => {
    servers.push(s);
    await new Promise<void>((done) => s.listen(0, '127.0.0.1', done));
    return (s.address() as AddressInfo).port;
  };

  it('passes a socket on to an allowed match port, with the client address, and nowhere else', async () => {
    // A worker match: echoes messages and says what it saw of the handshake.
    const worker = createServer();
    const wss = new WebSocketServer({ server: worker });
    wss.on('connection', (ws, req) => {
      ws.send(JSON.stringify({ path: req.url, forwarded: req.headers['x-forwarded-for'] }));
      ws.on('message', (m) => ws.send(`echo ${String(m)}`));
    });
    const workerPort = await listen(worker);

    const front = createServer();
    const router = upgradeRouterFor(front);
    router.origins = new OriginPolicy(['https://heist.school.test'], false);
    router.allowRelay((p) => p === workerPort);
    const frontPort = await listen(front);

    const open = (path: string, origin = 'https://heist.school.test') =>
      new Promise<{ status: string; messages: string[] }>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${frontPort}${path}`, { origin });
        const messages: string[] = [];
        ws.on('message', (m) => {
          messages.push(String(m));
          if (messages.length === 1) ws.send('hello');
          if (messages.length === 2) {
            ws.close();
            resolve({ status: 'open', messages });
          }
        });
        ws.on('unexpected-response', (_q, res) =>
          resolve({ status: String(res.statusCode), messages }),
        );
        ws.on('error', () => resolve({ status: 'error', messages }));
      });

    const ok = await open(`/at/${workerPort}/ws/game?x=1`);
    expect(ok.status).toBe('open');
    expect(JSON.parse(ok.messages[0] as string)).toEqual({
      path: '/ws/game?x=1',
      forwarded: '127.0.0.1',
    });
    expect(ok.messages[1]).toBe('echo hello');
    // A port that is not a match (the admin, a database) cannot be reached through this door.
    expect((await open('/at/22/ws/game')).status).toBe('404');
    expect((await open(`/at/${frontPort}/ws/game`)).status).toBe('404');
    // Paths other than the game sockets are not relayed.
    expect((await open(`/at/${workerPort}/admin`)).status).toBe('404');
    // The origin rule applies before anything is relayed.
    expect((await open(`/at/${workerPort}/ws/game`, 'https://evil.test')).status).toBe('403');
  });
});
