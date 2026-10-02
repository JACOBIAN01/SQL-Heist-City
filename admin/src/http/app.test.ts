import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createAdminApp } from './app';

describe('admin HTTP app', () => {
  let server: Server | undefined;

  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  async function get(path: string): Promise<Response> {
    server = createAdminApp().listen(0);
    await new Promise<void>((done) => server?.once('listening', done));
    const { port } = server.address() as AddressInfo;
    return fetch(`http://127.0.0.1:${port}${path}`);
  }

  it('reports health', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'admin', protocolVersion: 1 });
  });

  it('returns a JSON 404 for unknown API routes', async () => {
    const res = await get('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});
