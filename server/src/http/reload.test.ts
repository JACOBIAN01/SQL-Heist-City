import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpServer, type HttpServerDeps } from './httpServer';

let close: (() => Promise<void>) | undefined;
afterEach(() => close?.());

async function start(deps: Partial<HttpServerDeps>) {
  const server = createHttpServer({ now: () => 0, startedAt: 0, ...deps });
  await new Promise<void>((done) => server.listen(0, done));
  close = () => new Promise((done) => server.close(() => done()));
  const { port } = server.address() as AddressInfo;
  return (secret?: string) =>
    fetch(`http://127.0.0.1:${port}/internal/reload`, {
      method: 'POST',
      headers: secret === undefined ? {} : { 'x-internal-secret': secret },
    });
}

describe('POST /internal/reload', () => {
  it('runs the reload hook with the right secret', async () => {
    let reloads = 0;
    const reload = await start({ internalSecret: 's3cret', onReload: () => reloads++ });
    expect((await reload('s3cret')).status).toBe(204);
    expect(reloads).toBe(1);
  });

  it('refuses a wrong or missing secret', async () => {
    let reloads = 0;
    const reload = await start({ internalSecret: 's3cret', onReload: () => reloads++ });
    expect((await reload('nope')).status).toBe(403);
    expect((await reload()).status).toBe(403);
    expect(reloads).toBe(0);
  });

  it('does not exist when no secret is configured', async () => {
    const reload = await start({ onReload: () => {} });
    expect((await reload('anything')).status).toBe(404);
  });
});
