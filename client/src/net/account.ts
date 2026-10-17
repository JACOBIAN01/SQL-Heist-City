import { readPlayerSettings, type PlayerSettings } from '@heist/shared';

/** A signed-in player as the account service describes them. */
export interface AccountPlayer {
  readonly id: number;
  readonly displayName: string;
  readonly email: string;
  readonly schoolDomain: string | null;
  /** Whether they have said how old they are, and whether that was old enough. */
  readonly ageStatus: 'unknown' | 'ok' | 'too_young';
}

export type WhoAmI =
  | { readonly state: 'signed_in'; readonly player: AccountPlayer }
  | { readonly state: 'signed_out' }
  /** The account service did not answer (not running, or no network). */
  | { readonly state: 'unavailable' };

// SOLID: D — Why: the menu talks to this interface, so its tests use a fake and the real service
// (cookies, CORS, the marker header) stays in one class.
export interface AccountApi {
  me(): Promise<WhoAmI>;
  /** A one-use ticket for joining a match, or undefined when not signed in. */
  ticket(classId?: number): Promise<string | undefined>;
  /** Joins a class by the code the teacher gave out. */
  joinClass(code: string): Promise<{ id: number; name: string } | { error: string }>;
  signOut(): Promise<void>;
  rename(displayName: string): Promise<AccountPlayer | { error: string }>;
  /** The player's data as JSON text, to save as a file. */
  exportData(): Promise<string | undefined>;
  /** Deletes the account and everything keyed to it. */
  deleteAccount(): Promise<boolean>;
  /** Their settings on the account (the same on every device). */
  loadSettings(): Promise<{ settings: PlayerSettings; updatedAt: string } | undefined>;
  saveSettings(settings: PlayerSettings): Promise<void>;
  /** The age gate: the year they were born. Only the verdict is kept. */
  declareAge(birthYear: number): Promise<AccountPlayer | { error: string; tooYoung?: boolean }>;
  /** Where to send the browser to sign in; it returns to `returnTo`. */
  signInUrl(returnTo: string): string;
  /** Development only: sign in as a made-up player. */
  devSignInUrl(name: string, returnTo: string): string;
}

export class HttpAccountApi implements AccountApi {
  constructor(
    private readonly base: string,
    private readonly doFetch: typeof fetch = (...args) => fetch(...args),
  ) {}

  private call(path: string, init: RequestInit = {}): Promise<Response> {
    return this.doFetch(`${this.base}${path}`, {
      credentials: 'include',
      ...init,
      headers: { 'x-heist-player': '1', ...(init.headers ?? {}) },
    });
  }

  async me(): Promise<WhoAmI> {
    try {
      const res = await this.call('/auth/player/me');
      if (res.status === 401) return { state: 'signed_out' };
      if (!res.ok) return { state: 'unavailable' };
      const body = (await res.json()) as { player: AccountPlayer };
      return { state: 'signed_in', player: body.player };
    } catch {
      return { state: 'unavailable' };
    }
  }

  async joinClass(code: string): Promise<{ id: number; name: string } | { error: string }> {
    try {
      const res = await this.call('/auth/class/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body = (await res.json()) as {
        class?: { id: number; name: string };
        error?: { message: string };
      };
      return res.ok && body.class ? body.class : { error: body.error?.message ?? 'Could not join' };
    } catch {
      return { error: 'The account service is not reachable' };
    }
  }

  async ticket(classId?: number): Promise<string | undefined> {
    try {
      const res = await this.call('/auth/ticket', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(classId === undefined ? {} : { classId }),
      });
      if (!res.ok) return undefined;
      return ((await res.json()) as { ticket: string }).ticket;
    } catch {
      return undefined;
    }
  }

  async exportData(): Promise<string | undefined> {
    try {
      const res = await this.call('/auth/player/export');
      return res.ok ? await res.text() : undefined;
    } catch {
      return undefined;
    }
  }

  async loadSettings(): Promise<{ settings: PlayerSettings; updatedAt: string } | undefined> {
    try {
      const res = await this.call('/auth/player/settings');
      if (!res.ok) return undefined;
      const body = (await res.json()) as { settings: PlayerSettings | null; updatedAt?: string };
      return body.settings && body.updatedAt
        ? { settings: readPlayerSettings(body.settings), updatedAt: body.updatedAt }
        : undefined;
    } catch {
      return undefined;
    }
  }

  async saveSettings(settings: PlayerSettings): Promise<void> {
    const res = await this.call('/auth/player/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    if (!res.ok) throw new Error(`settings not saved (${res.status})`);
  }

  async declareAge(
    birthYear: number,
  ): Promise<AccountPlayer | { error: string; tooYoung?: boolean }> {
    try {
      const res = await this.call('/auth/player/age', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ birthYear }),
      });
      const body = (await res.json()) as {
        player?: AccountPlayer;
        error?: { code: string; message: string };
      };
      if (res.ok && body.player) return body.player;
      return {
        error: body.error?.message ?? 'Could not check your age',
        ...(body.error?.code === 'too_young' ? { tooYoung: true } : {}),
      };
    } catch {
      return { error: 'The account service is not reachable' };
    }
  }

  async deleteAccount(): Promise<boolean> {
    try {
      return (await this.call('/auth/player/me', { method: 'DELETE' })).status === 204;
    } catch {
      return false;
    }
  }

  async signOut(): Promise<void> {
    await this.call('/auth/player/logout', { method: 'POST' }).catch(() => {});
  }

  async rename(displayName: string): Promise<AccountPlayer | { error: string }> {
    try {
      const res = await this.call('/auth/player/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName }),
      });
      const body = (await res.json()) as { player?: AccountPlayer; error?: { message: string } };
      return res.ok && body.player
        ? body.player
        : { error: body.error?.message ?? 'Could not save' };
    } catch {
      return { error: 'The account service is not reachable' };
    }
  }

  devSignInUrl(name: string, returnTo: string): string {
    return `${this.base}/auth/dev/login?name=${encodeURIComponent(name)}&return=${encodeURIComponent(returnTo)}`;
  }

  signInUrl(returnTo: string): string {
    return `${this.base}/auth/google/login?return=${encodeURIComponent(returnTo)}`;
  }
}
