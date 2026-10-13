import type { ChallengeServerMessage } from '@heist/shared';
import type { IssueOptions } from '../challenges/ChallengeService';

/**
 * What the heist rules need from the SQL challenge system: hand it one
 * message from a player, get the reply. The real ChallengeMessageHandler
 * fits; tests pass a script (SOLID: D — Why: the game never imports the
 * grader, sandbox or database, so a match runs with or without them).
 */
export interface ChallengeGateway {
  /** `options` only matter for a task request (see IssueOptions). */
  handle(player: string, raw: unknown, options?: IssueOptions): Promise<ChallengeServerMessage>;
  playerLeft(player: string): void;
  /** The player was shot dead; an open question ends. */
  playerDied?(player: string): void;
}
