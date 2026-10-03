import type { HintResult, RejectReason } from '@heist/shared';

/** Player-facing wording for server refusals. Wording only — the rules live on the server. */
export function reasonMessage(reason: RejectReason, secondsUntilRetry?: number): string {
  switch (reason) {
    case 'unknown_reward':
      return 'The game does not know that task.';
    case 'no_questions':
      return 'No questions are available for this task right now. Ask your teacher to enable some.';
    case 'not_found':
      return 'This task is no longer active. Request a new one.';
    case 'expired':
      return 'This task expired. Request a new one.';
    case 'already_solved':
      return 'You already solved this task.';
    case 'rate_limited':
      return secondsUntilRetry !== undefined && secondsUntilRetry > 0
        ? `Slow down — try again in ${secondsUntilRetry} s.`
        : 'Slow down — try again in a moment.';
    case 'unavailable':
      return 'The checker is busy. Try again in a moment.';
  }
}

export const CONNECTION_MESSAGE =
  'Cannot reach the game server. Check your connection and try again.';

/** Wording for a refused hint request. */
export function hintFailureMessage(reason: Extract<HintResult, { ok: false }>['reason']): string {
  if (reason === 'no_such_hint') return 'There are no more hints for this task.';
  if (reason === 'out_of_order') return 'Reveal the earlier hint first.';
  return reasonMessage(reason);
}
