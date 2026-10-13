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
        .setSubject('google-sub-1')
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
