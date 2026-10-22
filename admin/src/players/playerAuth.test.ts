import { CONSENT_STATEMENTS, CONSENT_VERSION, playerSettingsSchema } from '@heist/shared';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT, generateKeyPair } from 'jose';
import { verifyTicket } from '@heist/server/auth/ticket';
import { startAdmin } from '../testing/harness';
import { GoogleOidc } from './GoogleOidc';

const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const GAME = 'http://localhost:5173';
const TICKET_SECRET = 'ticket-secret-ticket-secret';

type Claims = Record<string, unknown>;

/** A pretend Google: signs ID tokens with a key of our own and remembers what it was asked. */
async function fakeGoogle() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const state = {
    claims: {} as Claims,
    audience: CLIENT_ID,
    lastForm: undefined as URLSearchParams | undefined,
    nonceOverride: undefined as string | undefined,
    fail: false,
    sub: 'google-sub-1',
  };
  let nonceForNextToken = '';
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      state.lastForm = new URLSearchParams(body);
      if (state.fail) return void res.writeHead(400).end('{}');
      const token = await new SignJWT({
        email_verified: true,
        nonce: state.nonceOverride ?? nonceForNextToken,
        ...state.claims,
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer('https://accounts.google.com')
        .setAudience(state.audience)
        .setSubject(state.sub)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ id_token: token }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    state,
    tokenEndpoint: `http://127.0.0.1:${port}/token`,
    keys: async () => publicKey,
    expectNonce: (n: string) => (nonceForNextToken = n),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

let google: Awaited<ReturnType<typeof fakeGoogle>>;
let h: Awaited<ReturnType<typeof startAdmin>>;
let base: string;

async function boot(allowedDomains: string[] = []) {
  google = await fakeGoogle();
  const oidc = new GoogleOidc({
    clientId: CLIENT_ID,
    clientSecret: 'secret',
    redirectUri: 'http://localhost:8081/auth/google/callback',
    keys: google.keys,
    authEndpoint: 'http://google.test/auth',
    tokenEndpoint: google.tokenEndpoint,
  });
  h = await startAdmin({
    playerAuth: {
      oidc,
      ticketSecret: TICKET_SECRET,
      cookieSecret: 'cookie-secret-cookie-secret',
      gameOrigins: [GAME],
      allowedDomains,
    },
  });
  base = `http://127.0.0.1:${h.client.port}`;
}

const cookieOf = (res: Response) =>
  (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter(Boolean);

/** Runs login → Google → callback; returns the callback response and the cookies after it. */
async function signIn(over: { state?: string; code?: string | null } = {}) {
  const login = await fetch(
    `${base}/auth/google/login?return=${encodeURIComponent(`${GAME}/play`)}`,
    {
      redirect: 'manual',
    },
  );
  expect(login.status).toBe(302);
  const google_url = new URL(login.headers.get('location') as string);
  google.expectNonce(google_url.searchParams.get('nonce') as string);
  const flowCookie = cookieOf(login).join('; ');
  const callbackUrl = new URL(`${base}/auth/google/callback`);
  if (over.code !== null) callbackUrl.searchParams.set('code', over.code ?? 'the-code');
  callbackUrl.searchParams.set(
    'state',
    over.state ?? (google_url.searchParams.get('state') as string),
  );
  const res = await fetch(callbackUrl, { redirect: 'manual', headers: { cookie: flowCookie } });
  return { res, google_url, cookies: cookieOf(res).join('; ') };
}

/** Says how old the signed-in student is (the age gate, 21.7). */
async function declareAge(cookies: string, birthYear: number) {
  return fetch(`${base}/auth/player/age`, {
    method: 'POST',
    headers: {
      cookie: cookies,
      origin: GAME,
      'x-heist-player': '1',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ birthYear }),
  });
}

describe('player sign-in with Google', () => {
  beforeEach(() => boot());
  afterEach(async () => {
    await h.close();
    await google.close();
  });

  it('sends the browser to Google with PKCE, state and nonce', async () => {
    const { google_url } = await signIn();
    expect(google_url.origin + google_url.pathname).toBe('http://google.test/auth');
    expect(google_url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(google_url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(google_url.searchParams.get('scope')).toBe('openid email profile');
    for (const k of ['state', 'nonce', 'code_challenge'])
      expect((google_url.searchParams.get(k) ?? '').length).toBeGreaterThan(20);
  });

  it('signs a player in, proves the PKCE verifier, and returns them to the game', async () => {
    google.state.claims = { email: 'Ana@School.edu', name: 'Ana Silva', hd: 'school.edu' };
    const { res, google_url, cookies } = await signIn();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${GAME}/play`);
    const form = google.state.lastForm as URLSearchParams;
    expect(form.get('code')).toBe('the-code');
    expect(form.get('client_secret')).toBe('secret');
    expect(
      createHash('sha256')
        .update(form.get('code_verifier') as string)
        .digest('base64url'),
    ).toBe(google_url.searchParams.get('code_challenge'));
    expect(cookies).toContain('heist_player=');
    const me = await fetch(`${base}/auth/player/me`, { headers: { cookie: cookies } });
    expect(await me.json()).toEqual({
      player: {
        id: expect.any(Number),
        displayName: 'Ana Silva',
        email: 'ana@school.edu',
        schoolDomain: 'school.edu',
        ageStatus: 'unknown',
      },
    });
    // The same Google account is the same player next time.
    const again = await signIn();
    const me2 = await (
      await fetch(`${base}/auth/player/me`, { headers: { cookie: again.cookies } })
    ).json();
    expect((me2 as { player: { id: number } }).player.id).toBe(
      (
        (await (
          await fetch(`${base}/auth/player/me`, { headers: { cookie: cookies } })
        ).json()) as { player: { id: number } }
      ).player.id,
    );
  });

  it('refuses a callback whose state does not match, or that has no sign-in under way', async () => {
    const bad = await signIn({ state: 'forged' });
    expect(bad.res.status).toBe(400);
    expect(bad.cookies).not.toContain('heist_player=');
    const none = await fetch(`${base}/auth/google/callback?code=x&state=y`, { redirect: 'manual' });
    expect(none.status).toBe(400);
  });

  it('refuses an ID token with the wrong nonce, audience or an unverified email', async () => {
    const outcomes: string[] = [];
    for (const setup of [
      () => (google.state.nonceOverride = 'someone-elses-nonce'),
      () => ((google.state.nonceOverride = undefined), (google.state.audience = 'another-client')),
      () => (
        (google.state.audience = CLIENT_ID),
        (google.state.claims = { email: 'a@b.c', email_verified: false })
      ),
      () => ((google.state.claims = { email: 'a@b.c' }), (google.state.fail = true)),
    ]) {
      setup();
      const { res, cookies } = await signIn();
      expect(res.status).toBe(302);
      expect(cookies).not.toContain('heist_player=');
      outcomes.push(
        new URL(res.headers.get('location') as string).searchParams.get('signin_error') as string,
      );
    }
    expect(outcomes).toEqual([
      'nonce_mismatch',
      'bad_token',
      'email_unverified',
      'exchange_failed',
    ]);
  });

  it('treats a cancelled sign-in as a return with an error, not a crash', async () => {
    const { res } = await signIn({ code: null });
    expect(new URL(res.headers.get('location') as string).searchParams.get('signin_error')).toBe(
      'cancelled',
    );
  });

  it('will not return to an address that is not the game', async () => {
    const res = await fetch(
      `${base}/auth/google/login?return=${encodeURIComponent('https://evil.test/')}`,
      {
        redirect: 'manual',
      },
    );
    expect(res.status).toBe(400);
  });

  it('gives a signed-in player a game ticket, only from the game page', async () => {
    google.state.claims = { email: 'ana@school.edu', name: 'Ana Silva' };
    const { cookies } = await signIn();
    const headers = { cookie: cookies, origin: GAME, 'x-heist-player': '1' };
    // Not before they have said how old they are (21.7).
    const early = await fetch(`${base}/auth/ticket`, { method: 'POST', headers });
    expect(early.status).toBe(403);
    expect(await early.json()).toMatchObject({ error: { code: 'age_required' } });
    await declareAge(cookies, 2008);
    const ok = await fetch(`${base}/auth/ticket`, { method: 'POST', headers });
    expect(ok.headers.get('access-control-allow-origin')).toBe(GAME);
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    const { ticket } = (await ok.json()) as { ticket: string };
    expect(verifyTicket(TICKET_SECRET, ticket)).toMatchObject({
      ok: true,
      claims: { name: 'Ana Silva' },
    });
    // Another site, or no marker header, or no cookie.
    expect(
      (
        await fetch(`${base}/auth/ticket`, {
          method: 'POST',
          headers: { ...headers, origin: 'https://evil.test' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/auth/ticket`, {
          method: 'POST',
          headers: { cookie: cookies, origin: GAME },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/auth/ticket`, {
          method: 'POST',
          headers: { origin: GAME, 'x-heist-player': '1' },
        })
      ).status,
    ).toBe(401);
  });

  it('answers the browser’s preflight for the game origin only', async () => {
    const pre = await fetch(`${base}/auth/ticket`, {
      method: 'OPTIONS',
      headers: { origin: GAME },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toContain('x-heist-player');
    const other = await fetch(`${base}/auth/ticket`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.test' },
    });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers the preflight for every call the game page makes, joining a class included', async () => {
    for (const path of ['/auth/class/join', '/auth/player/settings', '/auth/ticket']) {
      const pre = await fetch(`${base}${path}`, { method: 'OPTIONS', headers: { origin: GAME } });
      expect(pre.headers.get('access-control-allow-origin'), path).toBe(GAME);
    }
  });

  it('signs out: the cookie stops working', async () => {
    google.state.claims = { email: 'ana@school.edu', name: 'Ana' };
    const { cookies } = await signIn();
    const out = await fetch(`${base}/auth/player/logout`, {
      method: 'POST',
      headers: { cookie: cookies, origin: GAME, 'x-heist-player': '1' },
    });
    expect(out.status).toBe(204);
    expect((await fetch(`${base}/auth/player/me`, { headers: { cookie: cookies } })).status).toBe(
      401,
    );
  });
});

describe('display names', () => {
  beforeEach(() => boot());
  afterEach(async () => {
    await h.close();
    await google.close();
  });
  const asGame = (cookies: string) => ({
    cookie: cookies,
    origin: GAME,
    'x-heist-player': '1',
    'content-type': 'application/json',
  });
  const rename = (cookies: string, displayName: string) =>
    fetch(`${base}/auth/player/me`, {
      method: 'PATCH',
      headers: asGame(cookies),
      body: JSON.stringify({ displayName }),
    });

  it('lets a player pick a clean name, and refuses a rude or broken one', async () => {
    google.state.claims = { email: 'ana@school.edu', name: 'Ana Silva' };
    const { cookies } = await signIn();
    const ok = await rename(cookies, '  Agent   Ana ');
    expect(((await ok.json()) as { player: { displayName: string } }).player.displayName).toBe(
      'Agent Ana',
    );
    for (const bad of ['sh1t head', '<script>', 'A', 'x'.repeat(40)]) {
      const res = await rename(cookies, bad);
      expect(res.status, bad).toBe(400);
    }
    const me = await (
      await fetch(`${base}/auth/player/me`, { headers: { cookie: cookies } })
    ).json();
    expect((me as { player: { displayName: string } }).player.displayName).toBe('Agent Ana');
    expect(
      (
        await fetch(`${base}/auth/player/me`, {
          method: 'PATCH',
          headers: { ...asGame(cookies), origin: 'https://evil.test' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
  });

  it('uses the word lists the admin sets', async () => {
    await h.loginAs('admin@school.test', 'admin');
    await h.client.put('/api/config/names', { names: { blocked: ['banana'] } });
    google.state.claims = { email: 'ana@school.edu', name: 'Ana' };
    const { cookies } = await signIn();
    expect((await rename(cookies, 'Banana Joe')).status).toBe(400);
    expect((await rename(cookies, 'shit')).status).toBe(200); // not on this school's list any more
  });

  it('lets staff find a player and rename them, with an audit entry, still through the filter', async () => {
    google.state.claims = { email: 'kid@school.edu', name: 'Kid One' };
    const { cookies } = await signIn();
    const me = (await (
      await fetch(`${base}/auth/player/me`, { headers: { cookie: cookies } })
    ).json()) as {
      player: { id: number };
    };
    await h.loginAs('teacher@school.test', 'teacher');
    const found = await h.client.get<{ players: { id: number; displayName: string }[] }>(
      '/api/players?q=kid',
    );
    expect(found.body.players.map((p) => p.id)).toEqual([me.player.id]);
    expect(
      (await h.client.put(`/api/players/${me.player.id}`, { displayName: 'fuck' })).status,
    ).toBe(400);
    const ok = await h.client.put<{ player: { displayName: string } }>(
      `/api/players/${me.player.id}`,
      {
        displayName: 'Kid Renamed',
      },
    );
    expect(ok.body.player.displayName).toBe('Kid Renamed');
    expect((await h.client.put('/api/players/9999', { displayName: 'Nobody' })).status).toBe(404);
    await h.admin.settled();
    h.client.clearCookie();
    await h.loginAs('boss@school.test', 'admin');
    const audit = await h.client.get<{ entries: { entity: string; detail: { to?: string } }[] }>(
      '/api/audit?entity=player',
    );
    expect(audit.body.entries[0]).toMatchObject({
      entity: 'player',
      detail: { from: 'Kid One', to: 'Kid Renamed' },
    });
  });
});

describe('my data', () => {
  beforeEach(() => boot());
  afterEach(async () => {
    await h.close();
    await google.close();
  });
  const marked = (cookies: string) => ({ cookie: cookies, origin: GAME, 'x-heist-player': '1' });

  it('hands a player their data, only to them and only from the game page', async () => {
    google.state.claims = { email: 'ana@school.edu', name: 'Ana Silva' };
    const { cookies } = await signIn();
    const res = await fetch(`${base}/auth/player/export`, { headers: marked(cookies) });
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const body = (await res.json()) as {
      data: { account: { email: string; googleSubject: string } };
    };
    expect(body.data.account).toMatchObject({
      email: 'ana@school.edu',
      googleSubject: 'google-sub-1',
    });
    expect(
      (await fetch(`${base}/auth/player/export`, { headers: { cookie: cookies } })).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/auth/player/export`, {
          headers: { origin: GAME, 'x-heist-player': '1' },
        })
      ).status,
    ).toBe(401);
  });

  it('deletes the account: signed out, gone for good, old names scrubbed from the audit', async () => {
    google.state.claims = { email: 'kid@school.edu', name: 'Kid Original' };
    const { cookies } = await signIn();
    const me = (await (
      await fetch(`${base}/auth/player/me`, { headers: { cookie: cookies } })
    ).json()) as {
      player: { id: number };
    };
    await h.loginAs('teacher@school.test', 'teacher');
    await h.client.put(`/api/players/${me.player.id}`, { displayName: 'Kid Renamed' });
    await h.admin.settled();

    const del = await fetch(`${base}/auth/player/me`, {
      method: 'DELETE',
      headers: marked(cookies),
    });
    expect(del.status).toBe(204);
    expect((await fetch(`${base}/auth/player/me`, { headers: { cookie: cookies } })).status).toBe(
      401,
    );
    expect((await h.client.get<{ players: unknown[] }>('/api/players?q=kid')).body.players).toEqual(
      [],
    );

    h.client.clearCookie();
    await h.loginAs('boss@school.test', 'admin');
    const audit = await h.client.get<{
      entries: { entity: string; action: string; detail: unknown }[];
    }>('/api/audit?entity=player');
    expect(audit.body.entries[0]).toMatchObject({ action: 'rename', detail: null });
    // Signing in again starts a brand-new account.
    const again = await signIn();
    const me2 = (await (
      await fetch(`${base}/auth/player/me`, { headers: { cookie: again.cookies } })
    ).json()) as {
      player: { id: number; displayName: string };
    };
    expect(me2.player.id).not.toBe(me.player.id);
    expect(me2.player.displayName).toBe('Kid Original');
  });
});

describe('joining a class', () => {
  beforeEach(() => boot());
  afterEach(async () => {
    await h.close();
    await google.close();
  });
  const marked = (cookies: string) => ({
    cookie: cookies,
    origin: GAME,
    'x-heist-player': '1',
    'content-type': 'application/json',
  });
  const join = (cookies: string, code: string) =>
    fetch(`${base}/auth/class/join`, {
      method: 'POST',
      headers: marked(cookies),
      body: JSON.stringify({ code }),
    });
  const ticketFor = (cookies: string, classId?: number) =>
    fetch(`${base}/auth/ticket`, {
      method: 'POST',
      headers: marked(cookies),
      body: JSON.stringify(classId === undefined ? {} : { classId }),
    });

  /** A class whose school has accepted the terms (unless told not to). */
  async function teacherClass(accept = true) {
    await h.loginAs('teacher@school.test', 'teacher');
    const made = (
      await h.client.post<{ class: { id: number; code: string } }>('/api/classes', { name: '9B' })
    ).body.class;
    if (accept)
      await h.client.post(`/api/classes/${made.id}/consent`, {
        version: CONSENT_VERSION,
        accepted: CONSENT_STATEMENTS.map((s) => s.id),
      });
    return made;
  }

  it('a student types the code, joins the roster once, and gets a ticket for that class only', async () => {
    const cls = await teacherClass();
    google.state.claims = { email: 'ana@school.edu', name: 'Ana' };
    const { cookies } = await signIn();
    await declareAge(cookies, 2008);
    const res = await join(
      cookies,
      ` ${cls.code.toLowerCase().slice(0, 3)}-${cls.code.slice(3).toLowerCase()} `,
    );
    expect(await res.json()).toEqual({ class: { id: cls.id, name: '9B' } });
    await join(cookies, cls.code); // a second time changes nothing
    const roster = await h.client.get<{ roster: { displayName: string }[] }>(
      `/api/classes/${cls.id}/roster`,
    );
    expect(roster.body.roster.map((r) => r.displayName)).toEqual(['Ana']);
    const t = (await (await ticketFor(cookies, cls.id)).json()) as { ticket: string };
    expect(verifyTicket(TICKET_SECRET, t.ticket)).toMatchObject({
      ok: true,
      claims: { classId: cls.id },
    });
  });

  it('refuses a wrong code, a locked class for newcomers, and a class ticket for a non-member', async () => {
    const cls = await teacherClass();
    google.state.claims = { email: 'ana@school.edu', name: 'Ana' };
    const { cookies } = await signIn();
    await declareAge(cookies, 2008);
    expect((await join(cookies, 'ZZZZZZ')).status).toBe(404);
    expect((await join(cookies, 'abc')).status).toBe(404);
    expect((await ticketFor(cookies, cls.id)).status).toBe(403);
    await join(cookies, cls.code);
    // Lock the class (as the teacher): Ana, already in, may return; a newcomer may not.
    await h.client.post(`/api/classes/${cls.id}/lock`, { locked: true });
    expect((await join(cookies, cls.code)).status).toBe(200);
    google.state.claims = { email: 'ben@school.edu', name: 'Ben' };
    google.state.sub = 'google-sub-ben';
    const ben = await signIn();
    await declareAge(ben.cookies, 2008);
    expect((await join(ben.cookies, cls.code)).status).toBe(403);
  });

  it('turns a student away until the school has accepted the terms, and until they have said their age (21.3, 21.7)', async () => {
    const cls = await teacherClass(false);
    google.state.claims = { email: 'ana@school.edu', name: 'Ana' };
    const { cookies } = await signIn();
    const noAge = await join(cookies, cls.code);
    expect(noAge.status).toBe(403);
    expect(await noAge.json()).toMatchObject({ error: { code: 'age_required' } });
    await declareAge(cookies, 2008);
    const noConsent = await join(cookies, cls.code);
    expect(noConsent.status).toBe(403);
    expect(await noConsent.json()).toMatchObject({ error: { code: 'consent_required' } });
    expect(
      (await h.client.get<{ roster: unknown[] }>(`/api/classes/${cls.id}/roster`)).body.roster,
    ).toEqual([]);
    await h.client.post(`/api/classes/${cls.id}/consent`, {
      version: CONSENT_VERSION,
      accepted: CONSENT_STATEMENTS.map((s) => s.id),
    });
    expect((await join(cookies, cls.code)).status).toBe(200);
  });

  it('limits code guessing per player', async () => {
    google.state.claims = { email: 'ana@school.edu', name: 'Ana' };
    const { cookies } = await signIn();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await join(cookies, 'ZZZZZZ')).status);
    expect(statuses.slice(0, 8).every((s) => s === 404)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('the age gate (21.7)', () => {
  beforeEach(() => boot());
  afterEach(async () => {
    await h.close();
    await google.close();
  });

  it('lets in someone old enough, keeps no birth year, and does not let a refused student try other years', async () => {
    google.state.claims = { email: 'ana@school.edu', name: 'Ana' };
    const { cookies } = await signIn();
    const thisYear = new Date().getUTCFullYear();
    const young = await declareAge(cookies, thisYear - 10);
    expect(young.status).toBe(403);
    expect(await young.json()).toMatchObject({ error: { code: 'too_young' } });
    // Saying a different year afterwards changes nothing.
    expect((await declareAge(cookies, thisYear - 20)).status).toBe(403);
    const ticket = await fetch(`${base}/auth/ticket`, {
      method: 'POST',
      headers: { cookie: cookies, origin: GAME, 'x-heist-player': '1' },
    });
    expect(await ticket.json()).toMatchObject({ error: { code: 'too_young' } });

    google.state.claims = { email: 'ben@school.edu', name: 'Ben' };
    google.state.sub = 'google-sub-ben';
    const ben = await signIn();
    const ok = await declareAge(ben.cookies, thisYear - 13);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ player: { ageStatus: 'ok' } });
    // Nothing but the verdict is stored: no column holds a year.
    const row = JSON.stringify(await h.stores.players.findBySub('google-sub-ben'));
    expect(row).not.toContain(String(thisYear - 13));
    expect((await declareAge(ben.cookies, 1990)).status).toBe(200); // already decided
  });

  it('asks for a real year', async () => {
    google.state.claims = { email: 'ana@school.edu', name: 'Ana' };
    const { cookies } = await signIn();
    for (const birthYear of [1800, 'nineteen', 99999])
      expect(
        (
          await fetch(`${base}/auth/player/age`, {
            method: 'POST',
            headers: {
              cookie: cookies,
              origin: GAME,
              'x-heist-player': '1',
              'content-type': 'application/json',
            },
            body: JSON.stringify({ birthYear }),
          })
        ).status,
      ).toBe(400);
  });
});

describe('player settings (22.1)', () => {
  beforeEach(() => boot());
  afterEach(async () => {
    await h.close();
    await google.close();
  });
  const headers = (cookies: string) => ({
    cookie: cookies,
    origin: GAME,
    'x-heist-player': '1',
    'content-type': 'application/json',
  });

  it("keeps a signed-in player's settings for next time, validated, and exports them with the rest", async () => {
    google.state.claims = { email: 'ana@school.edu', name: 'Ana' };
    const { cookies } = await signIn();
    const get = () => fetch(`${base}/auth/player/settings`, { headers: headers(cookies) });
    expect(await (await get()).json()).toEqual({ settings: null });

    const mine = playerSettingsSchema.parse({
      look: { sensitivity: 1.5, invertY: true, fov: 80 },
      keys: { jump: ['KeyJ'] },
      access: { textScale: 1.25, palette: 'deuteranopia', reducedMotion: 'on', subtitles: true },
    });
    const put = await fetch(`${base}/auth/player/settings`, {
      method: 'PUT',
      headers: headers(cookies),
      body: JSON.stringify({ settings: mine }),
    });
    expect(put.status).toBe(200);
    expect(await (await get()).json()).toMatchObject({ settings: mine });

    const bad = await fetch(`${base}/auth/player/settings`, {
      method: 'PUT',
      headers: headers(cookies),
      body: JSON.stringify({ settings: { look: { sensitivity: 99, invertY: false, fov: 70 } } }),
    });
    expect(bad.status).toBe(400);
    expect(await (await get()).json()).toMatchObject({ settings: mine }); // unchanged

    const data = await (
      await fetch(`${base}/auth/player/export`, { headers: headers(cookies) })
    ).text();
    expect(data).toContain('deuteranopia');
  });

  it('is private to the signed-in player and to the game page', async () => {
    const none = await fetch(`${base}/auth/player/settings`, {
      headers: { origin: GAME, 'x-heist-player': '1' },
    });
    expect(none.status).toBe(401);
    google.state.claims = { email: 'ana@school.edu', name: 'Ana' };
    const { cookies } = await signIn();
    const other = await fetch(`${base}/auth/player/settings`, {
      headers: { ...headers(cookies), origin: 'https://evil.test' },
    });
    expect(other.status).toBe(403);
  });

  it('goes with the account when it is deleted', async () => {
    google.state.claims = { email: 'ana@school.edu', name: 'Ana' };
    const { cookies } = await signIn();
    await fetch(`${base}/auth/player/settings`, {
      method: 'PUT',
      headers: headers(cookies),
      body: JSON.stringify({ settings: playerSettingsSchema.parse({}) }),
    });
    const player = await h.stores.players.findBySub('google-sub-1');
    expect(player).toBeDefined();
    await fetch(`${base}/auth/player/me`, { method: 'DELETE', headers: headers(cookies) });
    expect(await h.stores.playerSettings.get((player as { id: number }).id)).toBeUndefined();
  });
});

describe('player sign-in with a school allow-list', () => {
  beforeEach(() => boot(['school.edu']));
  afterEach(async () => {
    await h.close();
    await google.close();
  });

  it('lets school accounts in and turns others away', async () => {
    google.state.claims = { email: 'kid@gmail.com', name: 'Kid' };
    const no = await signIn();
    expect(new URL(no.res.headers.get('location') as string).searchParams.get('signin_error')).toBe(
      'domain_not_allowed',
    );
    expect(no.cookies).not.toContain('heist_player=');
    google.state.claims = { email: 'kid@school.edu', name: 'Kid' };
    const yes = await signIn();
    expect(yes.cookies).toContain('heist_player=');
  });
});

describe('development sign-in', () => {
  afterEach(async () => {
    await h.close();
    await google.close();
  });

  async function bootDev(devLogin: boolean) {
    await boot();
    await h.close();
    h = await startAdmin({
      playerAuth: {
        oidc: new GoogleOidc({
          clientId: 'x',
          clientSecret: 'x',
          redirectUri: 'http://x',
          keys: google.keys,
        }),
        ticketSecret: TICKET_SECRET,
        cookieSecret: 'cookie-secret-cookie-secret',
        gameOrigins: [GAME],
        allowedDomains: [],
        devLogin,
        googleEnabled: false,
      },
    });
    base = `http://127.0.0.1:${h.client.port}`;
  }
  const dev = (name: string) =>
    fetch(`${base}/auth/dev/login?name=${name}&return=${encodeURIComponent(`${GAME}/`)}`, {
      redirect: 'manual',
    });

  it('signs in a made-up player when enabled, who then gets tickets like anyone', async () => {
    await bootDev(true);
    const res = await dev('Tester');
    expect(res.status).toBe(302);
    const cookies = cookieOf(res).join('; ');
    const t = await fetch(`${base}/auth/ticket`, {
      method: 'POST',
      headers: { cookie: cookies, origin: GAME, 'x-heist-player': '1' },
    });
    expect(
      verifyTicket(TICKET_SECRET, ((await t.json()) as { ticket: string }).ticket),
    ).toMatchObject({
      ok: true,
      claims: { name: 'Tester' },
    });
  });

  it('does not exist when disabled, and Google says so when it is not set up', async () => {
    await bootDev(false);
    expect((await dev('Tester')).status).toBe(404);
    const g = await fetch(`${base}/auth/google/login?return=${encodeURIComponent(`${GAME}/`)}`, {
      redirect: 'manual',
    });
    expect(g.status).toBe(503);
  });
});

describe('the student profile page (26.9)', () => {
  beforeEach(() => boot());
  afterEach(async () => {
    await h.close();
    await google.close();
  });
  const headers = (cookies: string) => ({ cookie: cookies, origin: GAME, 'x-heist-player': '1' });

  it('is only for the signed-in student and from the game page', async () => {
    expect(
      (
        await fetch(`${base}/auth/player/profile`, {
          headers: { origin: GAME, 'x-heist-player': '1' },
        })
      ).status,
    ).toBe(401);
    google.state.claims = { email: 'ana@school.edu', name: 'Ana' };
    const { cookies } = await signIn();
    expect(
      (await fetch(`${base}/auth/player/profile`, { headers: { cookie: cookies } })).status,
    ).toBe(403);
  });

  it('shows real rank, history and wardrobe from the records, and nobody else’s', async () => {
    google.state.claims = { email: 'ana@school.edu', name: 'Ana' };
    const { cookies } = await signIn();
    const me = (await (
      await fetch(`${base}/auth/player/me`, { headers: headers(cookies) })
    ).json()) as {
      player: { id: number };
    };
    const id = me.player.id;
    await h.stores.progress.add(id, { learningXp: 250, playXp: 100 });
    await h.stores.loadout.put(id, { outfit: 'outfit-crimson', mask: 'mask-balaclava' }); // second one is not earned
    const ended = Date.now() - 3_600_000;
    await h.stores.classResults
      .record(1, {
        number: 4,
        startedAt: ended - 900_000,
        endedAt: ended,
        awards: [],
        standings: [{ rank: 2, accountId: id, name: 'Ana', banked: 7000, kills: 3, deaths: 1 }],
      })
      .catch(() => undefined); // a class row may not exist in this harness; the history is checked below if it does

    const page = (await (
      await fetch(`${base}/auth/player/profile`, { headers: headers(cookies) })
    ).json()) as {
      name: string;
      progress: { xp: number; rank: string };
      skills: { id: string; state: string }[];
      wardrobe: { choice: Record<string, string>; items: { id: string; unlocked: boolean }[] };
      streakDays: number;
      mastery: { rcsbe: unknown[]; bloom: unknown[] };
      history: { round: number; rank: number; banked: number; kills: number }[];
    };
    expect(page.name).toBe('Ana');
    expect(page.progress).toMatchObject({ xp: 350, rank: 'Runner' });
    expect(page.skills.find((n) => n.id === 'select')?.state).toBe('open');
    // The outfit is worn; the balaclava (rank Cracker) is not earned yet and is dropped.
    expect(page.wardrobe.choice).toEqual({ outfit: 'outfit-crimson' });
    expect(page.wardrobe.items.find((i) => i.id === 'outfit-street')?.unlocked).toBe(true);
    expect(page.history).toMatchObject([{ round: 4, rank: 2, banked: 7000, kills: 3 }]);
    expect(page.streakDays).toBe(0);
    expect(page.mastery.rcsbe.length).toBeGreaterThan(0);
    expect(page.mastery.bloom.length).toBeGreaterThan(0);
  });
});
