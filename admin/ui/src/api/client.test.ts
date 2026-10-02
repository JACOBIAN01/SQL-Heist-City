import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './client';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown, contentType = 'application/json') {
  const fetchMock = vi.fn(
    async () =>
      new Response(status === 204 ? null : typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': contentType },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('api client', () => {
  it('sends JSON with the CSRF header under /api', async () => {
    const fetchMock = stubFetch(200, { ok: true });
    await expect(api('/things', { method: 'POST', body: { a: 1 } })).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/things');
    expect(init.headers).toMatchObject({
      'x-heist-admin': '1',
      'content-type': 'application/json',
    });
    expect(init.body).toBe('{"a":1}');
  });

  it('turns API errors into ApiError with code and details', async () => {
    stubFetch(400, {
      error: { code: 'validation_failed', message: 'Bad', details: [{ path: 'tier' }] },
    });
    const err = await api('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 400,
      code: 'validation_failed',
      message: 'Bad',
      details: [{ path: 'tier' }],
    });
  });

  it('returns undefined for 204 and text for non-JSON', async () => {
    stubFetch(204, null);
    expect(await api('/x', { method: 'DELETE' })).toBeUndefined();
    stubFetch(200, 'a,b\n1,2', 'text/csv');
    expect(await api('/x')).toBe('a,b\n1,2');
  });
});
