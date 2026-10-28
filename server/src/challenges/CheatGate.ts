import type { CheatRefusal, CheatSettings } from '@heist/shared';
import { verifyCode } from '../security/CodeHash';

/** Where a pass is being asked for. */
export interface CheatContext {
  readonly classId?: number | undefined;
  readonly tutorial: boolean;
  readonly round?: number | undefined;
}

export type CheatVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: CheatRefusal; readonly lockedUntil?: number };

/** Least time (ms) between two tries by one player, whatever the settings. */
const MIN_GAP_MS = 1000;
/** Wrong codes across the whole match, as a multiple of one player's tries, before everyone waits. */
const MATCH_WIDE_FACTOR = 5;

interface Seen {
  fails: number;
  lockedUntil: number;
  lastTryAt: number;
  usedRound: number | undefined;
  used: number;
}

/**
 * Decides whether a typed cheat code passes the open question (Phase 37.2). The code is checked
 * against a hash that only exists in settings; where the cheat works, how many passes a player has
 * per round, and how long a run of wrong codes locks them out are all settings. A player who guesses
 * wrongly too often waits, and so does the whole match if many players guess wrongly together, so
 * reconnecting does not reset a brute-force attempt.
 * Pattern: Guard (a small policy object) — Why: the rules for "may this code pass" sit in one place,
 * away from the transport and the grader, and are tested without either.
 */
export class CheatGate {
  private readonly seen = new Map<string, Seen>();
  private wrongAt: number[] = [];

  constructor(
    private readonly settings: () => CheatSettings,
    private readonly now: () => number = Date.now,
    /** Local and staging servers (anything but production). */
    private readonly dev: boolean = process.env.NODE_ENV !== 'production',
    private readonly verify: (code: string, hash: string) => Promise<boolean> = verifyCode,
  ) {}

  /** Whether the cheat can work here at all (what the client is told). */
  available(context: CheatContext): boolean {
    const s = this.settings();
    return s.codeHash !== '' && this.inScope(s, context);
  }

  async check(player: string, code: string, context: CheatContext): Promise<CheatVerdict> {
    const s = this.settings();
    // Off, no code set, or not here: say nothing that tells a prober the feature exists.
    if (s.codeHash === '' || !this.inScope(s, context)) return { ok: false, reason: 'refused' };
    const now = this.now();
    const me = this.state(player);
    this.wrongAt = this.wrongAt.filter((t) => now - t < s.lockoutSeconds * 1000);
    const matchLock =
      this.wrongAt.length >= s.lockoutTries * MATCH_WIDE_FACTOR
        ? (this.wrongAt[0] as number) + s.lockoutSeconds * 1000
        : 0;
    const until = Math.max(me.lockedUntil, matchLock);
    if (now < until) return { ok: false, reason: 'locked', lockedUntil: until };
    if (now - me.lastTryAt < MIN_GAP_MS)
      return { ok: false, reason: 'locked', lockedUntil: me.lastTryAt + MIN_GAP_MS };
    me.lastTryAt = now;
    if (me.usedRound !== context.round) {
      me.usedRound = context.round;
      me.used = 0;
    }
    if (s.maxPerRound > 0 && me.used >= s.maxPerRound) return { ok: false, reason: 'limit' };
    if (!(await this.verify(code, s.codeHash))) {
      this.wrongAt.push(now);
      if (++me.fails >= s.lockoutTries) {
        me.fails = 0;
        me.lockedUntil = now + s.lockoutSeconds * 1000;
        return { ok: false, reason: 'locked', lockedUntil: me.lockedUntil };
      }
      return { ok: false, reason: 'wrong' };
    }
    me.fails = 0;
    return { ok: true };
  }

  /** The pass was used on a question: it counts against the player's limit. */
  used(player: string): void {
    this.state(player).used++;
  }

  forget(player: string): void {
    this.seen.delete(player);
  }

  private inScope(s: CheatSettings, c: CheatContext): boolean {
    switch (s.scope) {
      case 'off':
        return false;
      case 'dev':
        return this.dev;
      case 'tutorial':
        return c.tutorial;
      case 'rooms':
        return c.classId !== undefined && s.classIds.includes(c.classId);
      case 'all':
        return true;
    }
  }

  private state(player: string): Seen {
    let s = this.seen.get(player);
    if (!s) {
      s = { fails: 0, lockedUntil: 0, lastTryAt: 0, usedRound: undefined, used: 0 };
      this.seen.set(player, s);
    }
    return s;
  }
}
