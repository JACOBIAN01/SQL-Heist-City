import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpServer } from './httpServer';

describe('game server HTTP', () => {
  const server = createHttpServer({ now: () => 5_000, startedAt: 1_000 });

  afterEach(() => new Promise<void>((done) => server.close(() => done())));

  async function get(path: string): Promise<Response> {
    await new Promise<void>((done) => server.listen(0, done));
    const { port } = server.address() as AddressInfo;
    return fetch(`http://127.0.0.1:${port}${path}`);
  }

  it('reports health with protocol version and uptime', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', protocolVersion: 2, uptimeMs: 4_000 });
  });

  it('serves metrics only when a source is provided', async () => {
    const withMetrics = createHttpServer({
      now: () => 0,
      startedAt: 0,
      metrics: () => ({ players: 3, tickMs: { p95: 1.5 } }),
    });
    await new Promise<void>((done) => withMetrics.listen(0, done));
    const { port } = withMetrics.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(await res.json()).toEqual({ players: 3, tickMs: { p95: 1.5 } });
    await new Promise<void>((done) => withMetrics.close(() => done()));
    expect((await get('/metrics')).status).toBe(404);
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await get('/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});
