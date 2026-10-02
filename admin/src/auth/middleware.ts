import type { RequestHandler, Response } from 'express';
import type { AdminUser, Role } from '@heist/shared';
import { HttpError, forbidden, unauthorized } from '../http/errors';
import type { AuthService } from './AuthService';

export const SESSION_COOKIE = 'heist_session';
export const CSRF_HEADER = 'x-heist-admin';

/** The logged-in user for this request (set by `session`). */
export function currentUser(res: Response): AdminUser | undefined {
  return res.locals.user as AdminUser | undefined;
}

export function requireUser(res: Response): AdminUser {
  const user = currentUser(res);
  if (!user) throw unauthorized();
  return user;
}

/** Reads the session cookie and attaches the user (if any) to res.locals. */
export function session(auth: AuthService): RequestHandler {
  return (req, res, next) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) {
      const user = auth.userForToken(token);
      if (user) {
        res.locals.user = user;
        res.locals.sessionToken = token;
      }
    }
    next();
  };
}

/**
 * CSRF guard: state-changing requests must carry a custom header. Browsers
 * can't add custom headers to cross-site form posts, and the session cookie is
 * SameSite=Strict as a second layer.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.get(CSRF_HEADER) === '1')
    return next();
  next(new HttpError(403, 'csrf', `Missing ${CSRF_HEADER} header`));
};

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** Route guard: logged in, and (optionally) one of the given roles. */
export function requireRole(...roles: readonly Role[]): RequestHandler {
  return (_req, res, next) => {
    const user = currentUser(res);
    if (!user) return next(unauthorized());
    if (roles.length > 0 && !roles.includes(user.role)) return next(forbidden());
    next();
  };
}

/** Any logged-in user (admin or teacher). */
export const requireLogin = requireRole();
