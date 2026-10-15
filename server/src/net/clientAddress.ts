import type { IncomingMessage } from 'node:http';

/**
 * Who is asking, for per-client limits. Behind a reverse proxy every request comes from the
 * proxy, so with `TRUST_PROXY=1` the first `X-Forwarded-For` address is used instead; without
 * it the header is ignored (a client could write anything there).
 */
export function clientAddress(
  req: IncomingMessage,
  trustProxy = process.env.TRUST_PROXY === '1',
): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}
