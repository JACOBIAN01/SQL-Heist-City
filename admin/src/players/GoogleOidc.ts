import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { GoogleIdentity } from '@heist/server/players/PlayerRepository';

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export interface OidcConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  /** Google's signing keys (a remote JWKS in production, a local key in tests). */
  readonly keys: JWTVerifyGetKey;
  readonly authEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly issuers?: readonly string[];
  readonly fetch?: typeof fetch;
}

/** What must survive the trip to Google and back (kept in a signed cookie). */
export interface OidcFlow {
  readonly state: string;
  readonly nonce: string;
  readonly verifier: string;
}

/** Why a sign-in was refused. */
export class OidcError extends Error {
  constructor(
    readonly reason: 'exchange_failed' | 'bad_token' | 'email_unverified' | 'nonce_mismatch',
    message: string,
  ) {
    super(message);
    this.name = 'OidcError';
  }
}

const random = () => randomBytes(32).toString('base64url');

/**
 * Google OpenID Connect, authorization-code flow with PKCE (docs/identity.md).
 * The ID token is verified here, server side: signature against Google's keys,
 * issuer, audience, expiry, nonce, and a verified email.
 */
export class GoogleOidc {
  constructor(private readonly config: OidcConfig) {}

  /** Where to send the browser, and what to remember until it comes back. */
  begin(): { url: string; flow: OidcFlow } {
    const flow: OidcFlow = { state: random(), nonce: random(), verifier: random() };
    const url = new URL(this.config.authEndpoint ?? GOOGLE_AUTH_ENDPOINT);
    const params = {
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    };
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return { url: url.toString(), flow };
  }

  /** Exchanges the code for tokens and returns who signed in. */
  async complete(code: string, flow: OidcFlow): Promise<GoogleIdentity> {
    const doFetch = this.config.fetch ?? fetch;
    let idToken: string;
    try {
      const res = await doFetch(this.config.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          redirect_uri: this.config.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: flow.verifier,
        }),
      });
      if (!res.ok) throw new Error(`token endpoint answered ${res.status}`);
      const body = (await res.json()) as { id_token?: unknown };
      if (typeof body.id_token !== 'string') throw new Error('no id_token in the answer');
      idToken = body.id_token;
    } catch (err) {
      throw new OidcError('exchange_failed', (err as Error).message);
    }
    let claims: Record<string, unknown>;
    try {
      const verified = await jwtVerify(idToken, this.config.keys, {
        issuer: [...(this.config.issuers ?? GOOGLE_ISSUERS)],
        audience: this.config.clientId,
      });
      claims = verified.payload as Record<string, unknown>;
    } catch (err) {
      throw new OidcError('bad_token', (err as Error).message);
    }
    if (claims.nonce !== flow.nonce) throw new OidcError('nonce_mismatch', 'nonce does not match');
    if (claims.email_verified !== true)
      throw new OidcError('email_unverified', 'email is not verified');
    const email = String(claims.email ?? '').toLowerCase();
    if (typeof claims.sub !== 'string' || !email.includes('@'))
      throw new OidcError('bad_token', 'token has no subject or email');
    const hd = typeof claims.hd === 'string' ? claims.hd.toLowerCase() : null;
    return {
      sub: claims.sub,
      email,
      name:
        (typeof claims.name === 'string' && claims.name.trim()) || email.split('@')[0] || 'Player',
      domain: hd,
    };
  }
}
