import {
  REPLAY_MAX_EVENTS,
  REPLAY_MAX_SAMPLES,
  REPLAY_MAX_TRACKS,
  REPLAY_STEP_SECONDS,
  type ReplayEvent,
  type RoundReplay,
} from '@heist/shared';
import type { Player } from '../game/Player';
import type { HeistEvents } from './HeistEvents';
import type { MatchApi } from './MatchApi';

interface Track {
  readonly name: string;
  readonly from: number;
  readonly points: number[];
}

/**
 * Records a round for the teacher to replay (Phase 35.2): every few seconds where each student
 * stands, and the kills, locks, vaults, banked cash and solved questions as they happen. The finished
 * replay is attached to the round's result when the round ends.
 * Pattern: Observer — Why: it follows the heist's events and the tick, and no rule knows it exists.
 */
export class RoundRecorder {
  private startTick = 0;
  private readonly tracks = new Map<Player, Track>();
  private events: ReplayEvent[] = [];

  constructor(
    private readonly match: MatchApi,
    events: HeistEvents,
  ) {
    events.subscribe((e) => {
      switch (e.type) {
        case 'kill':
          if (!e.killer.isGuard && !e.victim.isDummy && this.watched(e.killer))
            this.note('kill', e.killer, { other: e.victim.name });
          break;
        case 'lock_opened':
          if (e.player) this.note('lock', e.player, { text: `bank-${e.vault.spec.tier}` });
          break;
        case 'vault_opened':
          if (e.by) this.note('vault', e.by, { text: `bank-${e.vault.spec.tier}` });
          break;
        case 'banked':
          this.note('banked', e.player, { text: String(e.amount) });
          break;
        case 'heist_failed':
          this.note('failed', e.player, { text: e.bank });
          break;
        case 'task_solved':
          this.note('solved', e.player, { text: e.rewardKey });
          break;
      }
    });
  }

  /** A new round begins. */
  reset(): void {
    this.startTick = this.match.tick;
    this.tracks.clear();
    this.events = [];
  }

  /** Every tick: every few seconds, where each student stands. */
  onTick(): void {
    const every = REPLAY_STEP_SECONDS * this.match.tickRate;
    const elapsed = this.match.tick - this.startTick;
    if (elapsed < 0 || elapsed % every !== 0) return;
    const index = elapsed / every;
    if (index >= REPLAY_MAX_SAMPLES) return;
    for (const player of this.match.playerList()) {
      if (!this.watched(player)) continue;
      let track = this.tracks.get(player);
      if (!track) {
        if (this.tracks.size >= REPLAY_MAX_TRACKS) continue;
        track = { name: player.name, from: index, points: [] };
        this.tracks.set(player, track);
      }
      track.points.push(Math.round(player.body.x), Math.round(player.body.z));
    }
  }

  /** The round as recorded so far; call when it ends. */
  snapshot(): RoundReplay {
    return {
      step: REPLAY_STEP_SECONDS,
      seconds: Math.round(this.seconds()),
      tracks: [...this.tracks.values()].map((t) => ({ ...t, points: [...t.points] })),
      events: [...this.events],
    };
  }

  /** Students only: not guards, police, escorts, cops or practice targets. */
  private watched(p: Player): boolean {
    return !(p.isGuard || p.isPolice || p.isVip || p.isDummy);
  }

  private seconds(): number {
    return (this.match.tick - this.startTick) / this.match.tickRate;
  }

  private note(kind: ReplayEvent['kind'], who: Player, more: { other?: string; text?: string }) {
    if (this.events.length >= REPLAY_MAX_EVENTS || !this.watched(who)) return;
    this.events.push({ at: Math.round(this.seconds()), kind, who: who.name, ...more });
  }
}
