import type { SquadMode, SquadStandingView } from '@heist/shared';
import type { Player } from '../game/Player';
import type { HeistEvents } from './HeistEvents';
import type { MatchApi } from './MatchApi';

/** What a class says about squads. */
export interface SquadConfig {
  readonly squadMode: SquadMode;
  readonly squadSize: number;
  /** The teacher's (or the balancer's) list: student account id → squad number. */
  readonly squads: Readonly<Record<number, number>>;
}

export type PickResult = 'ok' | 'full' | 'not_allowed' | 'unknown_squad' | 'has_banked';

/**
 * Squads inside a class room (Phase 27): who is in which, and how each squad scores. A squad's
 * score is its members' banked cash and kills added up, so squads score as one. Locks opened by a
 * member count for the squad too.
 *
 * Pattern: Observer (of the heist events) — Why: the vault and task rules do not know squads
 * exist; this listens for "a lock was opened" and keeps its own count.
 */
export class Squads {
  private config: SquadConfig = { squadMode: 'off', squadSize: 4, squads: {} };
  /** Squads students picked themselves, kept for the match so a reconnect lands where they were. */
  private readonly picked = new Map<number, number>();
  private readonly locks = new Map<number, number>();

  constructor(
    private readonly match: MatchApi,
    private readonly names: () => readonly string[],
    events: HeistEvents,
  ) {
    events.subscribe((event) => {
      if (event.type === 'lock_opened' && event.player && event.player.squad > 0)
        this.locks.set(event.player.squad, (this.locks.get(event.player.squad) ?? 0) + 1);
    });
  }

  /** The class's squad settings (at the start, and again when the teacher edits them). */
  configure(config: SquadConfig | undefined): void {
    this.config = config ?? { squadMode: 'off', squadSize: 4, squads: {} };
    for (const p of this.match.playerList()) this.place(p);
  }

  get enabled(): boolean {
    return this.config.squadMode !== 'off';
  }

  get mode(): SquadMode {
    return this.config.squadMode;
  }

  get size(): number {
    return this.config.squadSize;
  }

  /** How many squads there can be: as many as the class's player cap fills. */
  get count(): number {
    const cap = this.match.classInfo?.playerCap ?? 100;
    return Math.min(this.names().length, Math.ceil(cap / this.config.squadSize));
  }

  name(squad: number): string {
    return this.names()[squad - 1] ?? `Squad ${squad}`;
  }

  /** Puts a joining (or re-checked) player in their squad, if the class has one for them. */
  place(player: Player): void {
    if (!this.enabled || player.isDummy) {
      player.squad = 0;
      return;
    }
    const id = player.accountId;
    const assigned = id === undefined ? undefined : this.config.squads[id];
    // The teacher's list wins; in self-pick a student who chose one earlier goes back to it.
    const squad = assigned ?? (id === undefined ? undefined : this.picked.get(id));
    player.squad = squad !== undefined && squad >= 1 && squad <= this.count ? squad : 0;
  }

  members(squad: number): Player[] {
    return [...this.match.playerList()].filter((p) => p.squad === squad && !p.isDummy);
  }

  /**
   * A student picks (or leaves, with 0) a squad. Only in self-pick classes, only up to the size,
   * and only while they have banked nothing this round, so cash cannot be carried between squads.
   */
  pick(player: Player, squad: number): PickResult {
    if (this.config.squadMode !== 'self') return 'not_allowed';
    if (!Number.isInteger(squad) || squad < 0 || squad > this.count) return 'unknown_squad';
    if (player.banked > 0) return 'has_banked';
    if (squad > 0 && squad !== player.squad && this.members(squad).length >= this.config.squadSize)
      return 'full';
    player.squad = squad;
    if (player.accountId !== undefined) {
      if (squad === 0) this.picked.delete(player.accountId);
      else this.picked.set(player.accountId, squad);
    }
    return 'ok';
  }

  /** Squad scores, best first (a squad needs at least one member present to be listed). */
  table(): SquadStandingView[] {
    const by = new Map<number, { banked: number; kills: number; members: number }>();
    for (const p of this.match.playerList()) {
      if (p.squad <= 0 || p.isDummy) continue;
      const s = by.get(p.squad) ?? { banked: 0, kills: 0, members: 0 };
      by.set(p.squad, {
        banked: s.banked + p.banked,
        kills: s.kills + p.kills,
        members: s.members + 1,
      });
    }
    return [...by]
      .map(([squad, s]) => ({
        squad,
        name: this.name(squad),
        ...s,
        locks: this.locks.get(squad) ?? 0,
      }))
      .sort((a, b) => b.banked - a.banked || b.kills - a.kills || a.squad - b.squad);
  }

  /** A new round: the lock counts start again. */
  reset(): void {
    this.locks.clear();
  }
}
