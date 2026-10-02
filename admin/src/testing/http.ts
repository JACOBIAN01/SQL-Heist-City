import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

export interface TestResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

/** Starts an app on a random port and returns a tiny request helper that keeps cookies. */
export async function startTestServer(app: Express) {
  const server: Server = app.listen(0);
  await new Promise<void>((done) => server.once('listening', done));
  const { port } = server.address() as AddressInfo;
  let cookie = '';

  async function request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse<T>> {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
        // Same header the React app sends; see csrf guard.
        'x-heist-admin': '1',
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0] ?? '';
    const text = await res.text();
    const parsed =
      text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  return {
    request,
    get: <T = unknown>(path: string) => request<T>('GET', path),
    post: <T = unknown>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
    put: <T = unknown>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
    del: <T = unknown>(path: string) => request<T>('DELETE', path),
    clearCookie: () => {
      cookie = '';
    },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

export type TestClient = Awaited<ReturnType<typeof startTestServer>>;
