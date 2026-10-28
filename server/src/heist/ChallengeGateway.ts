import type {
  ChallengeServerMessage,
  CheatMessage,
  CheatResultMessage,
  CityDbSettings,
} from '@heist/shared';
import type { CheatContext } from '../challenges/CheatGate';
import type { SandboxRunner } from '../sql/SandboxRunner';
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
  /** The SQL sandbox and limits the city database uses (Phase 33); absent: no city database. */
  readonly city?: { run: SandboxRunner['run']; settings(): CityDbSettings } | undefined;
  /**
   * The cheat code was typed (Phase 37). `solved` is the usual correct result when it passed, and
   * `payReward` says whether the question's reward is paid. Absent: no cheat in this gateway.
   */
  cheat?(
    player: string,
    message: CheatMessage,
    context: CheatContext,
  ): Promise<{
    readonly result: CheatResultMessage;
    readonly solved?: ChallengeServerMessage;
    readonly payReward?: boolean;
  }>;
  /** The player was shot dead; an open question ends. */
  playerDied?(player: string): void;
}
