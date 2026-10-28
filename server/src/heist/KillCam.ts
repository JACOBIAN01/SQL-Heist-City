import type { KillCamMessage } from '@heist/shared';
import type { Player } from '../game/Player';
import type { HeistEvents } from './HeistEvents';
import type { MatchApi } from './MatchApi';

/** How long (s) the dead player watches from the killer's side. */
const SECONDS = 3.5;
/** A last answer older than this (s) is not worth quoting. */
const STALE_SECONDS = 600;

/**
 * The kill-cam (Phase 35.1). When a player is put down by another player they are told who did it and
 * how long that player's last answer took, so the killer's last query is part of the story of the
 * death: "Ben, whose last answer took 42 s". The client does the watching; the server only knows the
 * facts. Nothing is sent for a death with no killer, a guard or a practice target.
 * Pattern: Observer — Why: it follows kills and solved questions, and the rules know nothing of it.
 */
export class KillCam {
  private readonly lastSolve = new Map<
    Player,
    { seconds: number; at: number; rewardKey: string }
  >();

  constructor(
    private readonly match: MatchApi,
    events: HeistEvents,
  ) {
    events.subscribe((e) => {
      if (e.type === 'task_solved' && e.seconds !== undefined)
        this.lastSolve.set(e.player, {
          seconds: e.seconds,
          at: this.match.tick / this.match.tickRate,
          rewardKey: e.rewardKey,
        });
      else if (e.type === 'kill' && e.killer !== e.victim && !e.killer.isGuard && !e.victim.isDummy)
        this.send(e.killer, e.victim);
    });
  }

  forget(player: Player): void {
    this.lastSolve.delete(player);
  }

  private send(killer: Player, victim: Player): void {
    const last = this.lastSolve.get(killer);
    const fresh = last && this.match.tick / this.match.tickRate - last.at <= STALE_SECONDS;
    const message: KillCamMessage = {
      t: 'killcam',
      killer: { id: killer.id, name: killer.name },
      seconds: SECONDS,
      ...(fresh
        ? { lastAnswer: { seconds: Math.round(last.seconds), rewardKey: last.rewardKey } }
        : {}),
    };
    this.match.sendJson(victim, message);
  }
}
