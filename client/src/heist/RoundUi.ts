import type { RoundMessage, ScoresMessage, StandingMessage } from '@heist/shared';
import { formatClock } from '../ui/sql/labels';
import type { RoundView } from '../ui/hud/ScoreboardView';

/**
 * Follows the server's round messages: counts the clock down locally between
 * messages (the server only says how long is left), shows the final standings
 * when the round ends and clears them when the next one starts.
 */
export class RoundUi {
  private deadline = 0;
  private phase: 'playing' | 'ended' | undefined;

  constructor(private readonly view: RoundView) {}

  onRound(message: RoundMessage, nowMs: number): void {
    if (message.phase === 'playing') {
      this.phase = 'playing';
      this.deadline = nowMs + message.endsInSec * 1000;
      this.view.hideResults();
      this.update(nowMs);
      return;
    }
    this.phase = 'ended';
    this.deadline = nowMs + message.nextInSec * 1000;
    this.view.setTimer(undefined);
    this.view.showResults(message.winner, message.standings);
    this.update(nowMs);
  }

  onScores(message: ScoresMessage): void {
    this.view.setScores(message.top, message.players);
  }

  onStanding(message: StandingMessage): void {
    this.view.setStanding(message.rank, message.players);
  }

  /** Every frame (cheap: a few string compares). */
  update(nowMs: number): void {
    const left = Math.max(0, this.deadline - nowMs);
    if (this.phase === 'playing') this.view.setTimer(formatClock(left));
    else if (this.phase === 'ended') this.view.setNextIn(left / 1000);
  }
}
