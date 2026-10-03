import {
  challengeClientMessageSchema,
  type ChallengeClientMessage,
  type ChallengeServerMessage,
} from '@heist/shared';
import type { SettingsReader } from '../config/SettingsReader';
import type { ChallengeService } from './ChallengeService';
import { tiersForReward } from './tiers';

// Pattern: Command (message → handler) — Why: each client message is a small
// validated command mapped to one service call. The same handler serves the
// demo socket now and the full game connection in Phase 5, so challenge rules
// live in ChallengeService and nowhere in a transport.
export class ChallengeMessageHandler {
  constructor(
    private readonly service: ChallengeService,
    private readonly settings: SettingsReader,
    private readonly now: () => number = Date.now,
  ) {}

  /** Handles one raw (already JSON-parsed) message from a player and returns the reply. */
  async handle(player: string, raw: unknown): Promise<ChallengeServerMessage> {
    const parsed = challengeClientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      const ref =
        typeof (raw as { ref?: unknown })?.ref === 'number' ? (raw as { ref: number }).ref : null;
      return {
        t: 'challenge_error',
        ref,
        now: this.now(),
        code: 'bad_message',
        message: parsed.error.issues[0]?.message ?? 'Invalid message',
      };
    }
    return this.dispatch(player, parsed.data);
  }

  playerLeft(player: string): void {
    this.service.forgetPlayer(player);
  }

  private async dispatch(
    player: string,
    msg: ChallengeClientMessage,
  ): Promise<ChallengeServerMessage> {
    switch (msg.t) {
      case 'challenge_request': {
        const tiers = tiersForReward(msg.rewardKey, this.settings);
        const result = tiers
          ? await this.service.issue({
              player,
              rewardKey: msg.rewardKey,
              ...(msg.target === undefined ? {} : { target: msg.target }),
              tiers,
            })
          : ({ ok: false, reason: 'unknown_reward' } as const);
        return { t: 'challenge', ref: msg.ref, now: this.now(), result };
      }
      case 'challenge_run':
        return {
          t: 'challenge_preview',
          ref: msg.ref,
          now: this.now(),
          result: await this.service.run(player, msg.challengeId, msg.sql),
        };
      case 'challenge_submit':
        return {
          t: 'challenge_result',
          ref: msg.ref,
          now: this.now(),
          result: await this.service.submit(player, msg.challengeId, msg.sql),
        };
      case 'challenge_hint':
        return {
          t: 'challenge_hint',
          ref: msg.ref,
          now: this.now(),
          result: this.service.hint(player, msg.challengeId, msg.index),
        };
      case 'challenge_abandon':
        this.service.abandon(player);
        return { t: 'challenge_abandoned', ref: msg.ref, now: this.now() };
    }
  }
}
