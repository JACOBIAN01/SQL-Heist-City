import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { DEFAULT_RATE_LIMITS, rateLimitsFrom } from '@heist/shared';
import type { ChallengeMessageHandler } from '../challenges/ChallengeMessageHandler';
import { attachChallengeSocket } from '../challenges/ChallengeSocket';
import { attachPracticeSocket } from '../challenges/PracticeSocket';
import { CLOSE_RATE_LIMITED } from '../game/Match';
import { createHttpServer } from '../http/httpServer';
import { clientAddress } from './clientAddress';
import { KeyedLimiter } from './KeyedLimiter';
import { upgradeRouterFor } from './UpgradeRouter';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((d) => s.close(() => d()))));
});
const listen = async (s: Server) => {
  servers.push(s);
  await new Promise<void>((done) => s.listen(0, '127.0.0.1', done));
  return (s.address() as AddressInfo).port;
};
const stubHandler = {
  handle: async () => ({ t: 'challenge_error', ref: null, now: 0, code: 'x', message: 'x' }),
  playerLeft: () => {},
} as unknown as ChallengeMessageHandler;

describe('rate limits (18.2)', () => {
  it('reads operator overrides over the defaults, and refuses bad ones', () => {
    expect(rateLimitsFrom(undefined)).toEqual(DEFAULT_RATE_LIMITS);
    expect(
      rateLimitsFrom('{"connectionsPerIp":{"burst":5,"perMinute":10}}').connectionsPerIp,
    ).toEqual({ burst: 5, perMinute: 10 });
    expect(() => rateLimitsFrom('{"connectionsPerIp":{"burst":0,"perMinute":1}}')).toThrow();
  });

  it('keeps one bucket per key, refilling over time, and forgets idle keys', () => {
    let t = 0;
    const limiter = new KeyedLimiter({ burst: 2, perMinute: 60 }, () => t, 4);
    expect([limiter.take('a'), limiter.take('a'), limiter.take('a')]).toEqual([true, true, false]);
    expect(limiter.take('b')).toBe(true);
    t += 1000;
    expect(limiter.take('a')).toBe(true);
    for (const k of ['c', 'd', 'e', 'f', 'g']) limiter.take(k);
    expect(limiter.take('a')).toBe(true); // a pruned, fresh bucket: still works
  });

  it('only trusts X-Forwarded-For when told the server is behind a proxy', () => {
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
      socket: { remoteAddress: '10.0.0.1' },
    } as never;
    expect(clientAddress(req, false)).toBe('10.0.0.1');
    expect(clientAddress(req, true)).toBe('203.0.113.9');
  });

  it('refuses new sockets from an address over its connection limit', async () => {
    const http = createServer();
    const router = upgradeRouterFor(http);
    router.connections = new KeyedLimiter({ burst: 2, perMinute: 1 });
    const wss = new WebSocketServer({ noServer: true });
    wss.on('connection', (ws) => ws.close());
    router.route('/ws/x', wss);
    const port = await listen(http);
    const attempt = () =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/x`);
        ws.on('open', () => resolve('open'));
        ws.on('unexpected-response', (_q, res) => resolve(String(res.statusCode)));
        ws.on('error', () => resolve('error'));
      });
    expect([await attempt(), await attempt(), await attempt()]).toEqual(['open', 'open', '429']);
    wss.close();
  });

  it('answers 429 once an address is over the game server HTTP limit', async () => {
    const port = await listen(
      createHttpServer({
        now: () => 0,
        startedAt: 0,
        limiter: new KeyedLimiter({ burst: 3, perMinute: 1 }),
      }),
    );
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await fetch(`http://127.0.0.1:${port}/health`)).status);
    expect(codes).toEqual([200, 200, 200, 429]);
  });

  it('closes a challenge socket that sends too many messages', async () => {
    const http = createServer();
    attachChallengeSocket(http, stubHandler, { messageLimit: { burst: 3, perMinute: 1 } });
    const port = await listen(http);
    expect(await flood(`ws://127.0.0.1:${port}/ws/challenge`, 5)).toBe(CLOSE_RATE_LIMITED);
  });

  it('closes a practice socket that sends too many messages', async () => {
    const http = createServer();
    attachPracticeSocket(http, stubHandler, {
      topics: () => [],
      messageLimit: { burst: 3, perMinute: 1 },
    });
    const port = await listen(http);
    expect(await flood(`ws://127.0.0.1:${port}/ws/practice`, 5)).toBe(CLOSE_RATE_LIMITED);
  });
});

/** Opens a socket, sends `n` messages at once, and resolves with the close code. */
function flood(url: string, n: number): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.on('open', () => {
      for (let i = 0; i < n; i++) ws.send(JSON.stringify({ t: 'practice_topics' }));
    });
    ws.on('close', (code) => resolve(code));
  });
}
