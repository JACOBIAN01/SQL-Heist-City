import {
  SQUAD_ROLES,
  type HeistSettings,
  type SquadAwardView,
  type SquadMessage,
  type SquadMode,
  type SquadRole,
  type SquadStandingView,
  squadAwards,
} from '@heist/shared';
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
export type RoleResult = 'ok' | 'no_squad' | 'role_taken';

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
  private readonly solves = new Map<number, number>();
  /** A student's role kept for the match, so a reconnect gets it back. */
  private readonly roleKept = new Map<number, SquadRole>();

  constructor(
    private readonly match: MatchApi,
    private readonly names: () => readonly string[],
    private readonly settings: () => HeistSettings['roles'],
    events: HeistEvents,
    /** The reward a player has open in the SQL pop-up, if any. */
    private readonly taskOf: (player: Player) => string | undefined = () => undefined,
  ) {
    events.subscribe((event) => {
      if (event.type === 'lock_opened' && event.player && event.player.squad > 0)
        this.locks.set(event.player.squad, (this.locks.get(event.player.squad) ?? 0) + 1);
      if (event.type === 'task_solved' && event.player.squad > 0)
        this.solves.set(event.player.squad, (this.solves.get(event.player.squad) ?? 0) + 1);
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
    // A role comes back after a reconnect, if nobody else has taken it meanwhile.
    const kept = id === undefined ? undefined : this.roleKept.get(id);
    if (player.squad > 0 && kept && !this.roleTakenBy(player.squad, kept, player))
      player.role = kept;
    else if (player.squad === 0) player.role = null;
  }

  private roleTakenBy(squad: number, role: SquadRole, except: Player): Player | undefined {
    return this.members(squad).find((m) => m !== except && m.role === role);
  }

  /** Take a role in the squad (each role once per squad), or give it up with null. */
  pickRole(player: Player, role: SquadRole | null): RoleResult {
    if (player.squad <= 0) return 'no_squad';
    if (role !== null && this.roleTakenBy(player.squad, role, player)) return 'role_taken';
    player.role = role;
    if (player.accountId !== undefined) {
      if (role === null) this.roleKept.delete(player.accountId);
      else this.roleKept.set(player.accountId, role);
    }
    return 'ok';
  }

  /** Damage the player takes is multiplied by this: the enforcer on foot, the driver in a car. */
  damageScale(victim: Player): number {
    const r = this.settings();
    if (victim.role === 'enforcer' && victim.vehicleId === 0) return r.enforcerDamageScale;
    if (victim.role === 'driver' && victim.vehicleId !== 0) return r.driverCarDamageScale;
    return 1;
  }

  /** A hint costs this share of its price for this player (the hacker's perk). */
  hintScale(player: Player): number {
    return player.role === 'hacker' ? this.settings().hackerHintCostScale : 1;
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
    if (squad !== player.squad) {
      // A role belongs to a squad: moving on gives it up.
      player.role = null;
      if (player.accountId !== undefined) this.roleKept.delete(player.accountId);
    }
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
        solves: this.solves.get(squad) ?? 0,
      }))
      .sort((a, b) => b.banked - a.banked || b.kills - a.kills || a.squad - b.squad);
  }

  /** Who won what among the squads (empty when squads are off). */
  awards(): SquadAwardView[] {
    return this.enabled ? squadAwards(this.table()) : [];
  }

  /** What a student sees of squads: their own, who they can join, and their squad-mates. */
  messageFor(player: Player, denied?: SquadMessage['denied']): SquadMessage {
    const choices = [];
    for (let squad = 1; squad <= this.count; squad++) {
      const members = this.members(squad).length;
      choices.push({
        squad,
        name: this.name(squad),
        members,
        full: members >= this.config.squadSize,
      });
    }
    return {
      t: 'squad',
      mode: this.config.squadMode,
      size: this.config.squadSize,
      squad: player.squad,
      name: player.squad > 0 ? this.name(player.squad) : '',
      canPick: this.config.squadMode === 'self' && player.banked === 0,
      choices: this.config.squadMode === 'self' ? choices : [],
      members:
        player.squad > 0
          ? this.members(player.squad).map((m) => ({
              id: m.id,
              name: m.name,
              hp: m.hp,
              alive: m.alive,
              x: m.body.x,
              z: m.body.z,
              task: this.taskOf(m) ?? null,
              you: m === player,
              role: m.role,
            }))
          : [],
      role: player.role,
      roles: SQUAD_ROLES.map((role) => ({
        role,
        takenBy:
          player.squad > 0 ? (this.roleTakenBy(player.squad, role, player)?.name ?? null) : null,
      })),
      ...(denied ? { denied } : {}),
    };
  }

  /** Tells a student where they stand (on joining, and after a change). */
  send(player: Player, denied?: SquadMessage['denied']): void {
    if (this.enabled) this.match.sendJson(player, this.messageFor(player, denied));
  }

  /** Every second, squad-mates get each other's health, place and task. */
  onTick(): void {
    if (!this.enabled || this.match.tick % Math.max(1, this.match.tickRate) !== 0) return;
    for (const p of this.match.playerList()) {
      if (p.squad <= 0 || p.isDummy) continue;
      this.send(p);
      if (p.role === 'lookout') this.sendRadar(p);
    }
  }

  /** The lookout's perk: rivals within a radius, for their minimap. */
  private sendRadar(lookout: Player): void {
    const radius = this.settings().lookoutRadarMetres;
    if (radius <= 0 || !lookout.alive) return;
    const foes = this.match
      .playersNear(lookout.body.x, lookout.body.z, radius)
      .filter((p) => p !== lookout && p.alive && !p.isDummy && p.squad !== lookout.squad)
      .map((p) => ({ x: Math.round(p.body.x), z: Math.round(p.body.z) }));
    this.match.sendJson(lookout, { t: 'radar', foes });
  }

  /** A new round: the lock counts start again. */
  reset(): void {
    this.locks.clear();
    this.solves.clear();
  }
}
