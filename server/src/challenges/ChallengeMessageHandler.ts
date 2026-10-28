import {
  challengeClientMessageSchema,
  type CheatMessage,
  type CheatOutcome,
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

  cheatInfo(context: CheatContext): { combo: readonly string[] } | undefined {
    return this.gate.available(context)
      ? { combo: this.settings.cheatSettings().combo }
      : undefined;
  }

  playerLeft(player: string): void {
    this.service.forgetPlayer(player);
    this.gate.forget(player);
  }

  /**
   * A typed cheat code. Only when the gate agrees is the open question ended (as `cheat`, never as
   * solved); the reply says what it unlocked so the game pays the reward its usual way.
   */
  async cheat(
    player: string,
    message: CheatMessage,
    context: CheatContext,
  ): Promise<{
    reply: ChallengeServerMessage;
    passed?: { rewardKey: string; target: string | null };
    payReward?: boolean;
  }> {
    const reply = (result: CheatOutcome): ChallengeServerMessage => ({
      t: 'challenge_cheat',
      ref: message.ref,
      now: this.now(),
      result,
    });
    const verdict = await this.gate.check(player, message.code, context);
    if (!verdict.ok)
      return {
        reply: reply({
          ok: false,
          reason: verdict.reason,
          ...(verdict.lockedUntil === undefined ? {} : { lockedUntil: verdict.lockedUntil }),
        }),
      };
    const passed = this.service.pass(player, message.challengeId);
    if (passed.status !== 'correct') return { reply: reply({ ok: false, reason: 'no_task' }) };
    this.gate.used(player);
    const { rewardKey, target } = passed;
    return {
      reply: reply({ ok: true, rewardKey, target }),
      passed: { rewardKey, target },
      payReward: this.settings.cheatSettings().payReward,
    };
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
