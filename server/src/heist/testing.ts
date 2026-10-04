import type { ChallengeServerMessage } from '@heist/shared';
import type { ChallengeGateway } from './ChallengeGateway';

/** A gateway that records calls and answers from a script. */
export class ScriptedGateway implements ChallengeGateway {
  readonly calls: { player: string; raw: unknown }[] = [];
  readonly left: string[] = [];
  /** What the next call returns (set by the test). */
  answer: (raw: { t: string; ref: number }) => ChallengeServerMessage = (raw) => ({
    t: 'challenge_abandoned',
    ref: raw.ref,
    now: 0,
  });

  handle(player: string, raw: unknown): Promise<ChallengeServerMessage> {
    this.calls.push({ player, raw });
    return Promise.resolve(this.answer(raw as { t: string; ref: number }));
  }

  playerLeft(player: string): void {
    this.left.push(player);
  }
}

/** A "correct answer" reply for whatever reward the test is exercising. */
export const correctAnswer = (
  ref: number,
  rewardKey: string,
  target: string | null = null,
): ChallengeServerMessage => ({
  t: 'challenge_result',
  ref,
  now: 0,
  result: { status: 'correct', rewardKey, target },
});
