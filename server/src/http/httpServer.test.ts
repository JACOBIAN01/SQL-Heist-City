import { PROTOCOL_VERSION } from '@heist/shared';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { OriginPolicy } from '../net/OriginPolicy';
import { createHttpServer } from './httpServer';

describe('game server HTTP', () => {
  const server = createHttpServer({ now: () => 5_000, startedAt: 1_000 });

  afterEach(() => new Promise<void>((done) => server.close(() => done())));

  async function get(path: string): Promise<Response> {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    return fetch(`http://127.0.0.1:${port}${path}`);
  }

  it('reports health with protocol version and uptime', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      protocolVersion: PROTOCOL_VERSION,
      uptimeMs: 4_000,
    });
  });

  it('serves metrics only when a source is provided', async () => {
    const withMetrics = createHttpServer({
      now: () => 0,
      startedAt: 0,
      metrics: () => ({ players: 3, tickMs: { p95: 1.5 } }),
    });
    await new Promise<void>((done) => withMetrics.listen(0, '127.0.0.1', done));
    const { port } = withMetrics.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(await res.json()).toEqual({ players: 3, tickMs: { p95: 1.5 } });
    await new Promise<void>((done) => withMetrics.close(() => done()));
    expect((await get('/metrics')).status).toBe(404);
  });

  it("serves the lobby to the game's own pages only, and only when configured", async () => {
    const withLobby = createHttpServer({
      now: () => 0,
      startedAt: 0,
      lobby: () => ({ matches: [{ id: 1, port: 9001 }], open: { id: 1, port: 9001 } }),
      origins: new OriginPolicy(['https://heist.school.test'], false),
    });
    await new Promise<void>((done) => withLobby.listen(0, '127.0.0.1', done));
    const { port } = withLobby.address() as AddressInfo;
    const from = (origin?: string) =>
      fetch(`http://127.0.0.1:${port}/lobby`, origin ? { headers: { origin } } : {});
    const res = await from('https://heist.school.test');
    expect(res.headers.get('access-control-allow-origin')).toBe('https://heist.school.test');
    expect(await res.json()).toMatchObject({ open: { port: 9001 } });
    // Another site is refused; a tool with no Origin (bots, load tests) is not a browser page.
    const other = await from('https://evil.test');
    expect(other.status).toBe(403);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    expect((await from('http://localhost:5173')).status).toBe(403);
    expect((await from()).status).toBe(200);
    await new Promise<void>((done) => withLobby.close(() => done()));
    expect((await get('/lobby')).status).toBe(404);
  });

  it('serves Prometheus text, and keeps the metrics for the operator when protected (20.4)', async () => {
    const server = createHttpServer({
      now: () => 0,
      startedAt: 0,
      metrics: () => ({ players: 3 }),
      prometheus: () => 'heist_players{match="main"} 3\n',
      internalSecret: 'a-long-enough-internal-secret-for-this-test',
      protectMetrics: true,
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    const get = (path: string, headers: Record<string, string> = {}) =>
      fetch(`http://127.0.0.1:${port}${path}`, { headers });
    expect((await get('/metrics/prometheus')).status).toBe(403);
    expect((await get('/metrics')).status).toBe(403);
    const key = 'a-long-enough-internal-secret-for-this-test';
    const ok = await get('/metrics/prometheus', { authorization: `Bearer ${key}` });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('text/plain');
    expect(await ok.text()).toBe('heist_players{match="main"} 3\n');
    expect((await get('/metrics', { 'x-internal-secret': key })).status).toBe(200);
    expect((await get('/metrics/prometheus', { authorization: 'Bearer wrong' })).status).toBe(403);
    expect((await get('/health')).status).toBe(200); // health stays open for load balancers
    await new Promise<void>((done) => server.close(() => done()));
  });

  it("takes error reports from the game's own pages, validates, limits, and counts them (20.5)", async () => {
    const received: unknown[] = [];
    const server = createHttpServer({
      now: () => 0,
      startedAt: 0,
      onClientError: (e) => received.push(e),
      origins: new OriginPolicy(['https://heist.school.test'], false),
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    const post = (body: string, origin?: string) =>
      fetch(`http://127.0.0.1:${port}/client-error`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', ...(origin ? { origin } : {}) },
        body,
      });
    const report = { message: 'TypeError: x', source: 'error', page: '/' };
    const ok = await post(JSON.stringify(report), 'https://heist.school.test');
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://heist.school.test');
    expect(received).toEqual([report]);
    expect((await post(JSON.stringify(report), 'https://evil.test')).status).toBe(403);
    // A client that did not scrub (an old one, or a hand-made request) is scrubbed here.
    await post(
      JSON.stringify({
        message: 'failed for ana@school.edu with ticket=abc123def',
        stack: 'at http://h/?class=5&ticket=zz1234:1:1',
        source: 'error',
        page: '/',
      }),
    );
    expect(JSON.stringify(received.at(-1))).not.toMatch(/ana@|abc123def|zz1234|class=5/);
    received.pop();
    expect((await post('{"message": 5}')).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
    expect((await post(JSON.stringify({ ...report, message: 'x'.repeat(600) }))).status).toBe(400);
    expect((await post('x'.repeat(5000))).status).toBe(400);
    expect(received).toHaveLength(1);
    // A broken page that reports in a loop is cut off.
    const codes = [];
    for (let i = 0; i < 40; i++) codes.push((await post(JSON.stringify(report))).status);
    expect(codes).toContain(429);
    await new Promise<void>((done) => server.close(() => done()));
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await get('/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});
