import type { HeistSettings } from '@heist/shared';
import type { Player } from '../game/Player';
import type { HeistEvents } from './HeistEvents';
import type { MatchApi } from './MatchApi';

type Settings = HeistSettings['copsRobbers'];

interface Sample {
  readonly id: number;
  readonly robber: number;
  readonly name: string;
  readonly cash: number;
  readonly x: number;
  readonly z: number;
  readonly tick: number;
}

/**
 * Cops and robbers (Phase 34.1). In a room that plays it, every few players to join are the police:
 * armed, kept out of the vaults, scored for each robber they put down and for cash they recover.
 * The robbers' positions are logged every few seconds into a `trail` table, which only cops can
 * query (Phase 33's city database), so catching a robber is a matter of writing the right SELECT.
 * Pattern: Observer — Why: it listens to kills and the tick and leaves the heist rules alone.
 */
export class CopsRobbers {
  private joined = 0;
  private readonly log: Sample[] = [];
  private nextLog = 0;
  private nextSampleId = 1;

  constructor(
    private readonly match: MatchApi,
    private readonly settings: () => Settings,
    events: HeistEvents,
    private readonly active: () => boolean,
  ) {
    events.subscribe((e) => {
      if (!this.enabled() || e.type !== 'kill') return;
      if (e.killer.isCop && !e.victim.isCop && !e.victim.isDummy) {
        e.killer.banked += this.settings().arrestPoints;
        this.match.sendJson(e.killer, {
          t: 'notice',
          text: `Arrest! +$${this.settings().arrestPoints}`,
        });
      }
    });
  }

  enabled(): boolean {
    return this.settings().enabled && this.active();
  }

  /** The side a player is on: undefined outside a cops-and-robbers room. */
  teamOf(player: Player): 'cop' | 'robber' | undefined {
    if (!this.enabled() || player.isGuard || player.isDummy) return undefined;
    return player.isCop ? 'cop' : 'robber';
  }

  /** A player joined: every `copEvery`th is a cop. */
  assign(player: Player): void {
    if (!this.enabled() || player.isGuard || player.isDummy) return;
    this.joined++;
    player.isCop = this.joined % this.settings().copEvery === 0;
    this.match.sendJson(player, { t: 'team', role: player.isCop ? 'cop' : 'robber' });
  }

  /** A new life or round: a cop is armed and armoured. */
  equip(player: Player, giveGun: (player: Player) => void): void {
    if (!this.enabled() || !player.isCop) return;
    giveGun(player);
    player.armour = Math.max(player.armour, this.settings().copArmour);
  }

  /** Every tick: robbers' positions are logged every few seconds, and old entries drop out. */
  onTick(): void {
    if (!this.enabled()) return;
    const s = this.settings();
    const tick = this.match.tick;
    if (tick < this.nextLog) return;
    this.nextLog = tick + Math.round(s.logEverySeconds * this.match.tickRate);
    for (const p of this.match.playerList()) {
      if (p.isCop || p.isGuard || p.isDummy || !p.alive) continue;
      this.log.push({
        id: this.nextSampleId++,
        robber: p.id,
        name: p.name,
        cash: p.cash,
        x: p.body.x,
        z: p.body.z,
        tick,
      });
    }
    const keep = tick - Math.round(s.keepSeconds * this.match.tickRate);
    while (this.log.length > 0 && (this.log[0]?.tick ?? 0) < keep) this.log.shift();
  }

  /** The log as the city database lists it. */
  trail(): {
    id: number;
    robber: number;
    name: string;
    cash: number;
    x: number;
    z: number;
    ageS: number;
  }[] {
    const tick = this.match.tick;
    return this.log.map((l) => ({
      id: l.id,
      robber: l.robber,
      name: l.name,
      cash: l.cash,
      x: l.x,
      z: l.z,
      ageS: Math.round((tick - l.tick) / this.match.tickRate),
    }));
  }

  forget(player: Player): void {
    for (let i = this.log.length - 1; i >= 0; i--)
      if (this.log[i]?.robber === player.id) this.log.splice(i, 1);
  }

  /** A new round: the log starts empty. */
  reset(): void {
    this.log.length = 0;
    this.nextLog = 0;
  }
}
