import type { ChallengeServerMessage } from '@heist/shared';

/**
 * What the heist rules need from the SQL challenge system: hand it one
 * message from a player, get the reply. The real ChallengeMessageHandler
 * fits; tests pass a script (SOLID: D — Why: the game never imports the
 * grader, sandbox or database, so a match runs with or without them).
 */
export interface ChallengeGateway {
  handle(player: string, raw: unknown): Promise<ChallengeServerMessage>;
  playerLeft(player: string): void;
}
