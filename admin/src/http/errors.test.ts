import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { startTestServer, type TestClient } from '../testing/http';
import { HttpError, apiNotFound, errorHandler, parse } from './errors';

let client: TestClient | undefined;
afterEach(() => client?.close());

const logged: string[] = [];

async function appWith(handler: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  app.post('/x', handler);
  app.use(apiNotFound);
  app.use(errorHandler({ error: (m) => logged.push(m) }));
  client = await startTestServer(app);
  return client;
}

describe('errorHandler', () => {
  it('turns HttpError into its status and code', async () => {
    const c = await appWith(() => {
      throw new HttpError(409, 'conflict', 'Taken');
    });
    expect(await c.post('/x')).toMatchObject({
      status: 409,
      body: { error: { code: 'conflict', message: 'Taken' } },
    });
  });

  it('turns schema failures into 400 with field details', async () => {
    const c = await appWith((req, res) => {
      res.json(parse(z.object({ tier: z.number().max(5) }), req.body));
    });
    const res = await c.post('/x', { tier: 9 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { code: 'validation_failed', details: [{ path: 'tier' }] },
    });
  });

  it('rejects malformed JSON with 400', async () => {
    const c = await appWith((_req, res) => {
      res.json({});
    });
    expect(
      (await c.request('POST', '/x', '{oops', { 'content-type': 'application/json' })).status,
    ).toBe(400);
  });

  it('hides internals of unexpected errors but logs them', async () => {
    const c = await appWith(() => {
      throw new Error('db password is hunter2');
    });
    const res = await c.post('/x');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    expect(logged).toContain('unhandled admin API error');
  });

  it('handles async handler rejections (Express 5)', async () => {
    const c = await appWith(async () => {
      throw new HttpError(404, 'not_found', 'Nope');
    });
    expect((await c.post('/x')).status).toBe(404);
  });

  it('returns JSON 404 for unknown routes', async () => {
    const c = await appWith((_req, res) => {
      res.json({});
    });
    expect(await c.get('/nope')).toMatchObject({
      status: 404,
      body: { error: { code: 'not_found' } },
    });
  });
});
