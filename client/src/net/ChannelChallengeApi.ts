import {
  isChallengeServerMessage,
  type ChallengeClientMessage,
  type ChallengeServerMessage,
  type JsonServerMessage,
} from '@heist/shared';
import type { ChallengeApi } from './ChallengeApi';
import { ChallengeConnectionError } from './ChallengeApi';
import { JsonRpc } from './JsonRpc';

/** Where challenge messages travel: the game connection's JSON channel. */
export interface ChallengeChannel {
  send(message: ChallengeClientMessage): void;
}

// Pattern: Adapter — Why: the SQL panel asks for plain promises (ChallengeApi);
// this turns them into JSON messages on the game connection and matches the
// replies by ref, so the same panel runs on the demo socket and in the game.
export class ChannelChallengeApi implements ChallengeApi {
  private readonly rpc: JsonRpc<ChallengeClientMessage, ChallengeServerMessage>;
  private clockOffset = 0;

  constructor(
    channel: ChallengeChannel,
    private readonly now: () => number = Date.now,
    timeoutMs?: number,
  ) {
    this.rpc = new JsonRpc((message) => channel.send(message), timeoutMs);
  }

  /** Feed every JSON message from the server here; returns true if it was a challenge reply. */
  handle(message: JsonServerMessage): boolean {
    if (!isChallengeServerMessage(message)) return false;
    this.clockOffset = message.now - this.now();
    this.rpc.handle(message, 'challenge_error', (m) =>
      m.t === 'challenge_error' ? m.message : 'server error',
    );
    return true;
  }

  async request(rewardKey: string, target?: string) {
    const reply = await this.rpc.call('challenge', (ref) => ({
      t: 'challenge_request',
      ref,
      rewardKey,
      ...(target === undefined ? {} : { target }),
    }));
    return (reply as Extract<ChallengeServerMessage, { t: 'challenge' }>).result;
  }

  async run(challengeId: string, sql: string) {
    const reply = await this.rpc.call('challenge_preview', (ref) => ({
      t: 'challenge_run',
      ref,
      challengeId,
      sql,
    }));
    return (reply as Extract<ChallengeServerMessage, { t: 'challenge_preview' }>).result;
  }

  async submit(challengeId: string, sql: string) {
    const reply = await this.rpc.call('challenge_result', (ref) => ({
      t: 'challenge_submit',
      ref,
      challengeId,
      sql,
    }));
    return (reply as Extract<ChallengeServerMessage, { t: 'challenge_result' }>).result;
  }

  async hint(challengeId: string, index: number) {
    const reply = await this.rpc.call('challenge_hint', (ref) => ({
      t: 'challenge_hint',
      ref,
      challengeId,
      index,
    }));
    return (reply as Extract<ChallengeServerMessage, { t: 'challenge_hint' }>).result;
  }

  async abandon(): Promise<void> {
    await this.rpc.call('challenge_abandoned', (ref) => ({ t: 'challenge_abandon', ref }));
  }

  serverNow(): number {
    return this.now() + this.clockOffset;
  }

  /** The game connection closes with the game; this only fails requests still waiting. */
  close(): void {
    this.rpc.failAll(new ChallengeConnectionError('connection closed'));
  }
}
