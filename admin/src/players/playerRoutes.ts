import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { NAME_REASONS, checkDisplayName, type NameRules } from '@heist/shared';
import { issueTicket } from '@heist/server/auth/ticket';
import type {
  Player,
  PlayerRepository,
  PlayerSessions,
} from '@heist/server/players/PlayerRepository';
import { readCookie } from '../auth/middleware';
import type { GoogleOidc } from './GoogleOidc';
import { OidcError, type OidcFlow } from './GoogleOidc';
import type { PersonalDataRegistry } from '@heist/server/players/PersonalData';
import { readSigned, signValue } from './signedValue';

export const PLAYER_COOKIE = 'heist_player';
const FLOW_COOKIE = 'heist_oidc';
const FLOW_TTL_MS = 10 * 60 * 1000;

export interface PlayerAuthOptions {
  readonly oidc: GoogleOidc;
  readonly players: PlayerRepository;
  readonly sessions: PlayerSessions;
  /** Signs the game tickets; the game servers hold the same secret. */
  readonly ticketSecret: string;
  /** Signs the short-lived sign-in cookie. */
  readonly cookieSecret: string;
  /** Origins of the game page: the only places a sign-in may return to or call from. */
  readonly gameOrigins: readonly string[];
  /** Email domains allowed to sign in (empty: any verified Google account). */
  readonly allowedDomains: readonly string[];
  readonly secureCookies: boolean;
  readonly sessionTtlMs: number;
  /** Development only: `GET /auth/dev/login?name=…` signs in a test player with no Google. Never in production. */
  readonly devLogin?: boolean;
  /** Who holds personal data about a player (for export and deletion). */
  readonly personalData: PersonalDataRegistry;
  /** False when no Google client is configured (only the development sign-in then works). Default true. */
  readonly googleEnabled?: boolean;
  /** The display-name rules in force (the admin edits the word lists). */
  readonly nameRules: () => Promise<NameRules>;
  readonly now?: () => number;
}

interface FlowCookie extends OidcFlow {
  readonly returnTo: string;
  readonly exp: number;
}

const returnSchema = z.string().url().max(500);

/** The public name for a player on the wire: nothing but what they need to see. */
export const publicPlayer = (p: Player) => ({
  id: p.id,
  displayName: p.displayName,
  email: p.email,
  schoolDomain: p.schoolDomain,
});

/**
 * Sign-in for players (not staff): Google login, callback, who am I, sign out,
 * and the game ticket. Mounted outside /api so the staff CSRF guard and
 * session do not apply; these routes carry their own checks.
 */
export function playerRoutes(options: PlayerAuthOptions): Router {
  const router = Router();
  const now = options.now ?? Date.now;
  const baseCookie = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: options.secureCookies,
    path: '/',
  };
  const allowedOrigin = (origin: string | undefined): origin is string =>
    origin !== undefined && options.gameOrigins.includes(origin);

  // CORS for the calls the game page makes with the player's cookie.
  router.use('/auth/player', corsFor(allowedOrigin));
  router.use('/auth/ticket', corsFor(allowedOrigin));

  router.get('/auth/google/login', (req, res) => {
    if (options.googleEnabled === false) {
      res.status(503).json({
        error: { code: 'not_configured', message: 'Google sign-in is not set up on this server' },
      });
      return;
    }
    const target = returnSchema.safeParse(req.query.return);
    if (!target.success || !options.gameOrigins.includes(new URL(target.data).origin)) {
      res.status(400).json({ error: { code: 'bad_return', message: 'Unknown return address' } });
      return;
    }
    const { url, flow } = options.oidc.begin();
    const cookie: FlowCookie = { ...flow, returnTo: target.data, exp: now() + FLOW_TTL_MS };
    res.cookie(FLOW_COOKIE, signValue(options.cookieSecret, cookie), {
      ...baseCookie,
      maxAge: FLOW_TTL_MS,
    });
    res.redirect(302, url);
  });

  if (options.devLogin) {
    router.get('/auth/dev/login', async (req, res) => {
      const target = returnSchema.safeParse(req.query.return);
      const name = checkDisplayName(String(req.query.name ?? ''), {
        ...(await options.nameRules()),
        blocked: [],
      });
      if (
        !target.success ||
        !options.gameOrigins.includes(new URL(target.data).origin) ||
        !name.ok
      ) {
        res
          .status(400)
          .json({ error: { code: 'bad_request', message: 'Need ?name= and ?return=' } });
        return;
      }
      const player = await options.players.upsertFromGoogle(
        {
          sub: `dev:${name.name.toLowerCase()}`,
          email: `${name.name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@dev.test`,
          name: name.name,
          domain: 'dev.test',
        },
        new Date(now()),
      );
      const token = await options.sessions.create(player.id);
      res.cookie(PLAYER_COOKIE, token, { ...baseCookie, maxAge: options.sessionTtlMs });
      res.redirect(302, target.data);
    });
  }

  router.get('/auth/google/callback', async (req, res) => {
    const flow = readSigned<FlowCookie>(
      options.cookieSecret,
      readCookie(req.headers.cookie, FLOW_COOKIE),
    );
    res.clearCookie(FLOW_COOKIE, baseCookie);
    if (!flow || flow.exp <= now() || req.query.state !== flow.state) {
      res
        .status(400)
        .json({ error: { code: 'bad_state', message: 'Sign-in expired. Try again.' } });
      return;
    }
    const back = (reason: string) => {
      const url = new URL(flow.returnTo);
      url.searchParams.set('signin_error', reason);
      res.redirect(302, url.toString());
    };
    if (typeof req.query.code !== 'string') return back('cancelled');
    try {
      const identity = await options.oidc.complete(req.query.code, flow);
      const domain = identity.email.split('@')[1] ?? '';
      if (options.allowedDomains.length > 0 && !options.allowedDomains.includes(domain))
        return back('domain_not_allowed');
      const player = await options.players.upsertFromGoogle(
        { ...identity, domain: identity.domain ?? domain },
        new Date(now()),
      );
      const token = await options.sessions.create(player.id);
      res.cookie(PLAYER_COOKIE, token, { ...baseCookie, maxAge: options.sessionTtlMs });
      res.redirect(302, flow.returnTo);
    } catch (err) {
      if (err instanceof OidcError) return back(err.reason);
      throw err;
    }
  });

  const currentPlayer = async (req: Request): Promise<Player | undefined> => {
    const token = readCookie(req.headers.cookie, PLAYER_COOKIE);
    const id = token ? await options.sessions.playerIdFor(token) : undefined;
    return id === undefined ? undefined : options.players.findById(id);
  };
  // Calls with a cookie must come from the game page (CORS preflight enforces it for the custom header).
  const fromGamePage = (req: Request, res: Response): boolean => {
    if (req.get('x-heist-player') === '1' && allowedOrigin(req.get('origin'))) return true;
    res.status(403).json({ error: { code: 'csrf', message: 'Not from the game page' } });
    return false;
  };

  router.get('/auth/player/me', async (req, res) => {
    const player = await currentPlayer(req);
    if (!player) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Not signed in' } });
      return;
    }
    res.json({ player: publicPlayer(player) });
  });

  router.patch('/auth/player/me', express.json(), async (req, res) => {
    if (!fromGamePage(req, res)) return;
    const player = await currentPlayer(req);
    if (!player) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Not signed in' } });
      return;
    }
    const given = z.object({ displayName: z.string().max(100) }).safeParse(req.body);
    const verdict = given.success
      ? checkDisplayName(given.data.displayName, await options.nameRules())
      : ({ ok: false, reason: 'characters' } as const);
    if (!verdict.ok) {
      res.status(400).json({
        error: {
          code: 'bad_name',
          message: NAME_REASONS[verdict.reason] ?? 'That name is not allowed',
        },
      });
      return;
    }
    const renamed = await options.players.rename(player.id, verdict.name);
    res.json({ player: renamed && publicPlayer(renamed) });
  });

  router.get('/auth/player/export', async (req, res) => {
    if (!fromGamePage(req, res)) return;
    const player = await currentPlayer(req);
    if (!player) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Not signed in' } });
      return;
    }
    res.setHeader('content-disposition', 'attachment; filename="my-heist-data.json"');
    res.json({
      exportedAt: new Date(now()).toISOString(),
      data: await options.personalData.exportAll(player),
    });
  });

  router.delete('/auth/player/me', async (req, res) => {
    if (!fromGamePage(req, res)) return;
    const player = await currentPlayer(req);
    if (!player) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Not signed in' } });
      return;
    }
    await options.personalData.eraseAll(player);
    res.clearCookie(PLAYER_COOKIE, baseCookie);
    res.status(204).end();
  });

  router.post('/auth/player/logout', async (req, res) => {
    if (!fromGamePage(req, res)) return;
    const token = readCookie(req.headers.cookie, PLAYER_COOKIE);
    if (token) await options.sessions.revoke(token);
    res.clearCookie(PLAYER_COOKIE, baseCookie);
    res.status(204).end();
  });

  router.post('/auth/ticket', async (req, res) => {
    if (!fromGamePage(req, res)) return;
    const player = await currentPlayer(req);
    if (!player) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Not signed in' } });
      return;
    }
    res.json({
      ticket: issueTicket(options.ticketSecret, { id: player.id, name: player.displayName }, now()),
    });
  });

  return router;
}

function corsFor(allowed: (origin: string | undefined) => origin is string) {
  return (req: Request, res: Response, next: () => void) => {
    const origin = req.get('origin');
    if (allowed(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('access-control-allow-credentials', 'true');
      res.setHeader('access-control-allow-headers', 'content-type, x-heist-player');
      res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}
