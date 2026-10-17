/**
 * Where the game server and the account service are, from the page's own address (Phase 20.6).
 *
 * - Development (a page on plain http): the servers are on the same host at their own ports,
 *   `?server=<port>` picks the game server's (default 8080).
 * - A page on https: it can only talk https and wss, so everything goes to the page's own host
 *   on the standard port, where a reverse proxy routes `/ws`, `/lobby`, `/class`, `/client-error`
 *   to the game server and `/auth`, `/api` to the account service (deploy/Caddyfile). A match
 *   running on a worker port is reached through the game server at `/at/<port>/…`.
 * - `?server=https://game.example.org` names the game server outright (and `?account=` the account
 *   service), for pages served from a different host, such as a CDN.
 */
export interface PageLocation {
  readonly protocol: string;
  readonly hostname: string;
}

export class ServerAddress {
  private readonly base: URL;
  private readonly secure: boolean;
  /** Matches on their own ports are reachable directly only in development. */
  private readonly direct: boolean;

  constructor(
    page: PageLocation,
    server: string | null,
    private readonly accountOverride: string | null = null,
  ) {
    if (server && /^https?:\/\//.test(server)) {
      this.base = new URL(server);
      this.direct = false;
    } else if (page.protocol === 'https:') {
      this.base = new URL(`https://${page.hostname}`);
      this.direct = false;
    } else {
      this.base = new URL(`http://${page.hostname}:${server ?? '8080'}`);
      this.direct = true;
    }
    this.secure = this.base.protocol === 'https:';
  }

  /** An http(s) address on the game server, e.g. `/lobby`. */
  http(path: string): string {
    return `${this.base.origin}${path}`;
  }

  /** A ws(s) address on the game server, e.g. `/ws/tutorial`. */
  ws(path: string): string {
    return `${this.secure ? 'wss' : 'ws'}://${this.base.host}${path}`;
  }

  /** The game socket of a match that listens on its own port. */
  matchWs(port: number): string {
    return this.direct
      ? `ws://${this.base.hostname}:${port}/ws/game`
      : this.ws(`/at/${port}/ws/game`);
  }

  /** The account service. */
  account(): string {
    if (this.accountOverride) return this.accountOverride;
    return this.direct ? `http://${this.base.hostname}:8081` : this.base.origin;
  }
}

/** The address for the page we are on (`?server=` and `?account=` read from its query). */
export const serverAddressFor = (page: PageLocation, params: URLSearchParams): ServerAddress =>
  new ServerAddress(page, params.get('server'), params.get('account'));
