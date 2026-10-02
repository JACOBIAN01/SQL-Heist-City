import { afterEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestClient } from '../testing/http';
import { createAdminApp } from './app';

let client: TestClient | undefined;
afterEach(() => client?.close());

describe('admin app', () => {
  it('reports health', async () => {
    client = await startTestServer(createAdminApp({ logger: { error: () => {} } }));
    expect(await client.get('/health')).toMatchObject({
      status: 200,
      body: { status: 'ok', service: 'admin', protocolVersion: 1 },
    });
  });

  it('returns a JSON 404 for unknown API routes', async () => {
    client = await startTestServer(createAdminApp({ logger: { error: () => {} } }));
    expect(await client.get('/api/nope')).toMatchObject({
      status: 404,
      body: { error: { code: 'not_found' } },
    });
  });
});
