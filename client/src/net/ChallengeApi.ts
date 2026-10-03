import type { HintResult, IssueResult, RunResult, SubmitResult } from '@heist/shared';

/**
 * What the SQL panel needs from the game connection. The panel depends on
 * this interface, not on WebSocket, so it can be tested with a fake and
 * moved onto the full game connection in Phase 5 unchanged.
 */
// SOLID: D (Dependency Inversion) — Why: UI code never touches the network,
// so swapping the demo socket for the game connection (or a fake in tests)
// changes one composition root, not the panel.
export interface ChallengeApi {
  request(rewardKey: string, target?: string): Promise<IssueResult>;
  run(challengeId: string, sql: string): Promise<RunResult>;
  submit(challengeId: string, sql: string): Promise<SubmitResult>;
  /** Reveals hint `index` (in order). The first reveal is charged by the game; repeats are free. */
  hint(challengeId: string, index: number): Promise<HintResult>;
  /** Tells the server this player gave up their current task. */
  abandon(): Promise<void>;
  /** Best estimate of the server clock (epoch ms); lockouts and expiry are in server time. */
  serverNow(): number;
  close(): void;
}

/** The connection is down or timed out — nothing was decided by the server. */
export class ChallengeConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChallengeConnectionError';
  }
}

/** The server answered with something this client can't use. */
export class ChallengeProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChallengeProtocolError';
  }
}
