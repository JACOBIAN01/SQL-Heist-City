/**
 * Which web pages may open the game's sockets or read its lobby (Phase 18.1). A browser always
 * says where a page came from (`Origin`); a page on another site is refused, so it cannot use a
 * signed-in student's connection. Tools with no browser (bots, load tests) send no Origin and
 * are let through: the check protects browsers, it does not authenticate.
 *
 * Allowed: the origins in `GAME_ORIGINS` (comma-separated), the server's own origin, and in
 * development any localhost page (Vite serves the game on its own port).
 */
export class OriginPolicy {
  constructor(
    private readonly allowed: readonly string[],
    private readonly allowLocalhost: boolean,
  ) {}

  static fromEnv(env: Readonly<Record<string, string | undefined>>): OriginPolicy {
    const list = (env.GAME_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean);
    return new OriginPolicy(list, env.NODE_ENV !== 'production');
  }

  /** `host` is the request's Host header (a page served by this server is same-origin). */
  allows(origin: string | undefined, host: string | undefined): boolean {
    if (origin === undefined) return true;
    if (this.allowed.includes(origin)) return true;
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return false; // "null" (sandboxed frames, files) and junk
    }
    if (host !== undefined && url.host === host) return true;
    return this.allowLocalhost && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  }
}
