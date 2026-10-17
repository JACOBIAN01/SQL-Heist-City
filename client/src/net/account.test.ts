import { describe, expect, it } from 'vitest';
import { HttpAccountApi } from './account';

const ana = { id: 1, displayName: 'Ana', email: 'ana@school.edu', schoolDomain: 'school.edu' };

function api(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { api: new HttpAccountApi('http://acct.test', fake), calls };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('HttpAccountApi', () => {
  it('says who is signed in, always with the cookie and the marker header', async () => {
    const { api: a, calls } = api(() => json({ player: ana }));
    expect(await a.me()).toEqual({ state: 'signed_in', player: ana });
    expect(calls[0]?.url).toBe('http://acct.test/auth/player/me');
    expect(calls[0]?.init.credentials).toBe('include');
    expect((calls[0]?.init.headers as Record<string, string>)['x-heist-player']).toBe('1');
  });

  it('tells signed out from an unreachable service', async () => {
    expect(await api(() => json({}, 401)).api.me()).toEqual({ state: 'signed_out' });
    expect(await api(() => json({}, 500)).api.me()).toEqual({ state: 'unavailable' });
    expect(
      await api(() => {
        throw new TypeError('network');
      }).api.me(),
    ).toEqual({ state: 'unavailable' });
  });

  it('fetches a ticket, or nothing when not signed in', async () => {
    expect(await api(() => json({ ticket: 'abc.def' })).api.ticket()).toBe('abc.def');
    expect(await api(() => json({}, 401)).api.ticket()).toBeUndefined();
  });

  it('signs out with a POST and builds the Google sign-in address', async () => {
    const { api: a, calls } = api(() => new Response(null, { status: 204 }));
    await a.signOut();
    expect(calls[0]).toMatchObject({
      url: 'http://acct.test/auth/player/logout',
      init: { method: 'POST' },
    });
    expect(a.signInUrl('http://localhost:5173/')).toBe(
      'http://acct.test/auth/google/login?return=http%3A%2F%2Flocalhost%3A5173%2F',
    );
  });

  it('renames, and reports why it could not', async () => {
    expect(
      await api(() => json({ player: { ...ana, displayName: 'New' } })).api.rename('New'),
    ).toMatchObject({
      displayName: 'New',
    });
    expect(
      await api(() => json({ error: { message: 'That name is not allowed' } }, 400)).api.rename(
        'x',
      ),
    ).toEqual({ error: 'That name is not allowed' });
  });
});

describe('classes', () => {
  it('joins by code and asks for a class ticket', async () => {
    const { api: a, calls } = api((url) =>
      url.endsWith('/join') ? json({ class: { id: 5, name: '9B' } }) : json({ ticket: 'T' }),
    );
    expect(await a.joinClass('abc')).toEqual({ id: 5, name: '9B' });
    expect(calls[0]?.init.body).toBe(JSON.stringify({ code: 'abc' }));
    expect(await a.ticket(5)).toBe('T');
    expect(calls[1]?.init.body).toBe(JSON.stringify({ classId: 5 }));
  });

  it('reports why a code did not work', async () => {
    expect(
      await api(() => json({ error: { message: 'No class has that code.' } }, 404)).api.joinClass(
        'x',
      ),
    ).toEqual({ error: 'No class has that code.' });
  });
});
