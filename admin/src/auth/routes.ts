import { Router } from 'express';
import { loginRequestSchema } from '@heist/shared';
import { HttpError, parse } from '../http/errors';
import type { AuthService } from './AuthService';
import type { LoginRateLimiter } from './LoginRateLimiter';
import { SESSION_COOKIE, requireUser } from './middleware';

export interface AuthRouteOptions {
  readonly secureCookies: boolean;
  readonly sessionTtlMs: number;
}

export function authRoutes(
  auth: AuthService,
  limiter: LoginRateLimiter,
  options: AuthRouteOptions,
): Router {
  const router = Router();
  const cookie = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: options.secureCookies,
    path: '/api',
  };

  router.post('/auth/login', async (req, res) => {
    const { email, password } = parse(loginRequestSchema, req.body);
    const key = `${email}|${req.ip}`;
    const blockedUntil = limiter.blockedUntil(key);
    if (blockedUntil !== undefined) {
      res.set('retry-after', String(Math.ceil((blockedUntil - Date.now()) / 1000)));
      throw new HttpError(429, 'too_many_attempts', 'Too many failed logins. Try again later.');
    }
    const outcome = await auth.login(email, password);
    if (!outcome.ok) {
      limiter.recordFailure(key);
      throw new HttpError(401, 'invalid_credentials', 'Wrong email or password');
    }
    limiter.reset(key);
    res.cookie(SESSION_COOKIE, outcome.token, { ...cookie, maxAge: options.sessionTtlMs });
    res.json({ user: outcome.user });
  });

  router.post('/auth/logout', (_req, res) => {
    const token = res.locals.sessionToken as string | undefined;
    if (token) auth.logout(token);
    res.clearCookie(SESSION_COOKIE, cookie);
    res.status(204).end();
  });

  router.get('/auth/me', (_req, res) => {
    res.json({ user: requireUser(res) });
  });

  return router;
}
