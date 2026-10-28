import {
  challengeClientMessageSchema,
  type CheatMessage,
  type CheatResultMessage,
  type ChallengeClientMessage,
  type ChallengeServerMessage,
  type CityDbSettings,
} from '@heist/shared';
import type { SettingsReader } from '../config/SettingsReader';
import type { SandboxRunner } from '../sql/SandboxRunner';
import type { ChallengeService, IssueOptions } from './ChallengeService';
import { tiersForReward } from './tiers';
import { CheatGate, type CheatContext } from './CheatGate';

// Pattern: Command (message → handler) — Why: each client message is a small
// validated command mapped to one service call. The same handler serves the
// demo socket now and the full game connection in Phase 5, so challenge rules
// live in ChallengeService and nowhere in a transport.
export class ChallengeMessageHandler {
  constructor(
    private readonly service: ChallengeService,
    private readonly settings: SettingsReader,
    private readonly now: () => number = Date.now,
    /** Runs a student's SQL against the city's live tables (Phase 33); absent in tests. */
    readonly city?: { run: SandboxRunner['run']; settings(): CityDbSettings } | undefined,
  ) {}

  /**
   * Handles one raw (already JSON-parsed) message from a player and returns the
   * reply. `options` shape how a requested task is issued (the tutorial's).
   */
  async handle(
    player: string,
    raw: unknown,
    options: IssueOptions = {},
  ): Promise<ChallengeServerMessage> {
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
    return this.dispatch(player, parsed.data, options);
  }

  /** Decides who may pass a question with the cheat code (Phase 37). */
  private readonly gate = new CheatGate(
    () => this.settings.cheatSettings(),
    () => this.now(),
  );

  playerLeft(player: string): void {
    this.service.forgetPlayer(player);
    this.gate.forget(player);
  }

  /**
   * A typed cheat code. Only when the gate agrees is the open question ended (as `cheat`, never as
   * solved) and its correct result returned, so the game pays the reward its usual way.
   */
  async cheat(
    player: string,
    message: CheatMessage,
    context: CheatContext,
  ): Promise<{
    result: CheatResultMessage;
    solved?: ChallengeServerMessage;
    payReward?: boolean;
  }> {
    const refuse = (
      reason: Extract<CheatResultMessage, { ok: boolean }>['reason'],
      lockedUntil?: number,
    ) => ({
      result: {
        t: 'cheat_result' as const,
        ref: message.ref,
        ok: false,
        ...(reason ? { reason } : {}),
        ...(lockedUntil === undefined ? {} : { lockedUntil }),
      },
    });
    const verdict = await this.gate.check(player, message.code, context);
    if (!verdict.ok) return refuse(verdict.reason, verdict.lockedUntil);
    const passed = this.service.pass(player, message.challengeId);
    if (passed.status !== 'correct') return refuse('no_task');
    this.gate.used(player);
    return {
      result: { t: 'cheat_result', ref: message.ref, ok: true },
      solved: { t: 'challenge_result', ref: message.ref, now: this.now(), result: passed },
      payReward: this.settings.cheatSettings().payReward,
    };
  }

  playerDied(player: string): void {
    this.service.playerDied(player);
  }

  private async dispatch(
    player: string,
    msg: ChallengeClientMessage,
    options: IssueOptions,
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
              ...options,
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
          result: await this.service.submit(player, msg.challengeId, msg.sql, msg.answer),
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
