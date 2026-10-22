import type { DuelMessage, DuelSettings } from '@heist/shared';
import type { Player } from '../game/Player';
import type { IssueOptions } from '../challenges/ChallengeService';
import type { ChallengeGateway } from './ChallengeGateway';
import type { HeistEvents } from './HeistEvents';
import type { MatchApi } from './MatchApi';

type State = 'countdown' | 'draw' | 'between' | 'over';

interface Duel {
  readonly id: number;
  readonly a: Player;
  readonly b: Player;
  score: Map<Player, number>;
  /** The draw being played, 1-based. */
  draw: number;
  state: State;
  /** Tick at which the state ends. */
  until: number;
  drawId: number;
  /** Who won the last draw, once played. */
  last: Player | null | undefined;
}

/** The pause after a draw, and after a duel, before the next thing starts. */
const BETWEEN_SECONDS = 2;
const OVER_SECONDS = 4;

/**
 * SQL Quick Draw (Phase 28.3): one against one. Students wait in a queue; two are paired, get a
 * short countdown, and then both are asked the very same question. The first correct answer wins
 * the draw — a shot, counted as a kill — and the duel goes to whoever wins more than half the
 * draws. The server pairs, draws, times and judges; the client only shows what it is told.
 *
 * Pattern: State machine per duel — Why: countdown, draw, pause and result each have their own
 * clock and rules, and writing them as states keeps a late answer or a quitter from corrupting one.
 */
export class DuelManager {
  private readonly queue: Player[] = [];
  private readonly duels = new Map<Player, Duel>();
  private readonly lastOpponent = new Map<Player, Player>();
  private nextDuelId = 1;
  private drawCounter = 0;

  constructor(
    private readonly match: MatchApi,
    private readonly settings: () => DuelSettings | undefined,
    private readonly events: HeistEvents,
    private readonly matchSeed: string,
    private readonly challenges: () => ChallengeGateway | undefined,
  ) {}

  /** Duels are on when the class's mode is the duel kind. */
  get enabled(): boolean {
    return this.settings() !== undefined;
  }

  onJoin(player: Player): void {
    if (!this.enabled || player.isDummy) return;
    this.queue.push(player);
    this.send(player);
    this.pairUp();
  }

  /** A player left: the opponent wins by default, and they leave the queue. */
  onLeave(player: Player): void {
    const queued = this.queue.indexOf(player);
    if (queued >= 0) this.queue.splice(queued, 1);
    const duel = this.duels.get(player);
    if (!duel || duel.state === 'over') return;
    const other = duel.a === player ? duel.b : duel.a;
    // Default win: enough points to clinch it.
    duel.score.set(other, Math.max(duel.score.get(other) ?? 0, this.clinch()));
    this.finish(duel);
  }

  /** A new round: duels stop and everyone goes back in the queue. */
  reset(): void {
    for (const duel of new Set(this.duels.values())) this.release(duel);
    this.duels.clear();
    this.queue.length = 0;
    for (const p of this.match.playerList()) {
      if (p.isDummy) continue;
      this.queue.push(p);
      this.send(p);
    }
    this.pairUp();
  }

  /** May this player start the draw's question now: in a duel whose draw is open and not yet won? */
  canAnswer(player: Player): boolean {
    const duel = this.duels.get(player);
    return duel?.state === 'draw';
  }

  /** How the question of the player's current draw is issued: the same for both sides. */
  optionsFor(player: Player): IssueOptions | undefined {
    const duel = this.duels.get(player);
    const s = this.settings();
    if (!duel || duel.state !== 'draw' || !s) return undefined;
    const released = this.match.classInfo?.questions;
    const allowed = new Set(released ? Object.values(released).flat() : []);
    return {
      shared: { seed: `${this.matchSeed}|duel${duel.id}|draw${duel.draw}`, maxTier: s.maxTier },
      allowedQuestions: allowed,
      noHints: true,
    };
  }

  /** The server graded a duel answer correct. The first one in a draw wins it. */
  solved(player: Player): void {
    const duel = this.duels.get(player);
    if (!duel || duel.state !== 'draw') return;
    this.endDraw(duel, player);
  }

  onTick(): void {
    if (!this.enabled) return;
    const tick = this.match.tick;
    for (const duel of new Set(this.duels.values())) {
      if (tick < duel.until) {
        // A countdown and a draw tick down visibly once a second.
        if (
          (duel.state === 'countdown' || duel.state === 'draw') &&
          tick % this.match.tickRate === 0
        )
          this.sendBoth(duel);
        continue;
      }
      switch (duel.state) {
        case 'countdown':
          this.startDraw(duel);
          break;
        case 'draw':
          this.endDraw(duel, null); // nobody solved it in time
          break;
        case 'between':
          this.afterDraw(duel);
          break;
        case 'over':
          this.release(duel);
          for (const p of [duel.a, duel.b]) {
            this.duels.delete(p);
            if (this.match.getPlayer(p.id) === p) this.queue.push(p);
            this.send(p);
          }
          this.pairUp();
          break;
      }
    }
  }

  /** What a student sees of their duel (or of the queue). */
  messageFor(player: Player): DuelMessage {
    const duel = this.duels.get(player);
    const s = this.settings();
    if (!duel || !s)
      return {
        t: 'duel',
        state: 'waiting',
        opponent: null,
        you: 0,
        them: 0,
        draw: 0,
        draws: s?.draws ?? 0,
        drawId: 0,
        seconds: 0,
      };
    const other = duel.a === player ? duel.b : duel.a;
    const you = duel.score.get(player) ?? 0;
    const them = duel.score.get(other) ?? 0;
    const left = Math.max(0, Math.ceil((duel.until - this.match.tick) / this.match.tickRate));
    return {
      t: 'duel',
      state: duel.state,
      opponent: other.name,
      you,
      them,
      draw: duel.draw,
      draws: s.draws,
      drawId: duel.drawId,
      seconds: duel.state === 'countdown' || duel.state === 'draw' ? left : 0,
      ...(duel.last !== undefined && (duel.state === 'between' || duel.state === 'over')
        ? {
            last:
              duel.last === null
                ? ('none' as const)
                : duel.last === player
                  ? ('you' as const)
                  : ('them' as const),
          }
        : {}),
      ...(duel.state === 'over'
        ? {
            result:
              you > them ? ('win' as const) : you < them ? ('lose' as const) : ('tie' as const),
          }
        : {}),
    };
  }

  // --- the state machine ---

  private pairUp(): void {
    while (this.queue.length >= 2) {
      const a = this.queue.shift() as Player;
      // Not straight back to the last opponent, when somebody else is waiting.
      const at = Math.max(
        0,
        this.queue.findIndex((p) => p !== this.lastOpponent.get(a)),
      );
      const [b] = this.queue.splice(at, 1) as [Player];
      this.begin(a, b);
    }
  }

  private begin(a: Player, b: Player): void {
    const s = this.settings();
    if (!s) return;
    const duel: Duel = {
      id: this.nextDuelId++,
      a,
      b,
      score: new Map([
        [a, 0],
        [b, 0],
      ]),
      draw: 0,
      state: 'countdown',
      until: this.match.tick + this.ticks(s.countdownSeconds),
      drawId: 0,
      last: undefined,
    };
    this.duels.set(a, duel);
    this.duels.set(b, duel);
    this.lastOpponent.set(a, b);
    this.lastOpponent.set(b, a);
    duel.draw = 1;
    this.sendBoth(duel);
  }

  private startDraw(duel: Duel): void {
    const s = this.settings();
    if (!s) return;
    duel.state = 'draw';
    duel.drawId = ++this.drawCounter;
    duel.until = this.match.tick + this.ticks(s.drawSeconds);
    duel.last = undefined;
    this.sendBoth(duel);
  }

  private endDraw(duel: Duel, winner: Player | null): void {
    duel.last = winner;
    if (winner) {
      const loser = winner === duel.a ? duel.b : duel.a;
      duel.score.set(winner, (duel.score.get(winner) ?? 0) + 1);
      // The shot: the winner's point is a kill, so it counts on the scoreboard and shows in the feed.
      winner.kills++;
      loser.deaths++;
      this.events.publish({ type: 'kill', killer: winner, victim: loser });
      // The loser's question is dropped: the draw is over.
      this.challenges()?.playerDied?.(loser.key);
      this.challenges()?.playerDied?.(winner.key);
    } else {
      this.challenges()?.playerDied?.(duel.a.key);
      this.challenges()?.playerDied?.(duel.b.key);
    }
    duel.state = 'between';
    duel.until = this.match.tick + this.ticks(BETWEEN_SECONDS);
    this.sendBoth(duel);
  }

  private afterDraw(duel: Duel): void {
    const s = this.settings();
    if (!s) return;
    const [x, y] = [duel.score.get(duel.a) ?? 0, duel.score.get(duel.b) ?? 0];
    if (Math.max(x, y) >= this.clinch() || duel.draw >= s.draws) {
      this.finish(duel);
      return;
    }
    duel.draw++;
    duel.state = 'countdown';
    duel.until = this.match.tick + this.ticks(Math.min(2, s.countdownSeconds));
    this.sendBoth(duel);
  }

  private finish(duel: Duel): void {
    duel.state = 'over';
    duel.until = this.match.tick + this.ticks(OVER_SECONDS);
    this.sendBoth(duel);
  }

  private release(duel: Duel): void {
    this.challenges()?.playerDied?.(duel.a.key);
    this.challenges()?.playerDied?.(duel.b.key);
  }

  /** Points that win the duel: more than half the draws. */
  private clinch(): number {
    return Math.floor((this.settings()?.draws ?? 5) / 2) + 1;
  }

  private sendBoth(duel: Duel): void {
    this.send(duel.a);
    this.send(duel.b);
  }

  private send(player: Player): void {
    if (this.match.getPlayer(player.id) === player)
      this.match.sendJson(player, this.messageFor(player));
  }

  private ticks(seconds: number): number {
    return Math.round(seconds * this.match.tickRate);
  }
}
