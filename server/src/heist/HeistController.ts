import {
  DEFAULT_HEIST_SETTINGS,
  jsonClientMessageSchema,
  mapWithClosedDoors,
  type ChallengeServerMessage,
  type HeistSettings,
  type JsonClientMessage,
  type RejectReason,
} from '@heist/shared';
import type { Player } from '../game/Player';
import type { ChallengeGateway } from './ChallengeGateway';
import { ElevatorHandler } from './ElevatorHandler';
import { InteractionService } from './InteractionService';
import { TaskRules } from './TaskRule';
import { VaultConsoleHandler } from './VaultConsoleHandler';
import { VaultLockRule } from './VaultLockRule';
import { VaultRegistry } from './VaultRegistry';
import type { MatchApi } from './MatchApi';

/**
 * The heist rules of a match, behind the JSON messages. The match calls in;
 * this object decides what each message means and answers through MatchApi.
 * Pattern: Facade — Why: Match stays about movement and shooting; vaults,
 * loot and tasks grow here without touching the tick loop.
 */
export class HeistController {
  readonly interactions: InteractionService;
  readonly vaults: VaultRegistry;

  readonly tasks = new TaskRules();

  constructor(
    private readonly match: MatchApi,
    readonly settings: HeistSettings = DEFAULT_HEIST_SETTINGS,
    private readonly challenges?: ChallengeGateway,
    private readonly now: () => number = Date.now,
  ) {
    this.vaults = new VaultRegistry(match.map, settings.locksPerVault);
    this.interactions = new InteractionService(match)
      .register('elevator', new ElevatorHandler())
      .register('vault_console', new VaultConsoleHandler(this.vaults));
    this.tasks.add(
      new VaultLockRule(this.vaults, match, (id, lock) => this.openLock(id, lock), {
        onSolved: (player, vaultId, lock, opened) => {
          if (!opened)
            this.match.sendJson(player, { t: 'notice', text: 'Someone opened that lock first.' });
        },
      }),
    );
    this.refreshDoors();
  }

  /** A player just joined: tell them where every vault stands. */
  onJoin(player: Player): void {
    this.match.sendJson(player, { t: 'vaults', vaults: this.vaults.views() });
  }

  /**
   * Opens lock `lock` of a vault (the SQL reward calls this). Returns false if
   * it was not the next lock, e.g. a second player solved the same one.
   */
  openLock(vaultId: string, lock: number): boolean {
    const vault = this.vaults.get(vaultId);
    if (!vault || vault.openLock(lock) !== 'opened') return false;
    this.refreshDoors();
    this.match.broadcastJson({ t: 'vaults', vaults: this.vaults.views() });
    return true;
  }

  private refreshDoors(): void {
    this.match.setCollisionMap(mapWithClosedDoors(this.match.map, this.vaults.closedDoorIds()));
  }

  /** One JSON text frame from a player. Malformed input is ignored: the sender is untrusted. */
  onJson(player: Player, text: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return;
    }
    const parsed = jsonClientMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.t === 'interact') {
      this.match.sendJson(player, {
        t: 'interact_result',
        ref: message.ref,
        anchor: message.anchor,
        result: this.interactions.use(player, message.anchor),
      });
      return;
    }
    this.onChallenge(player, message, raw);
  }

  /** A player left: their challenge state goes with them. */
  onLeave(player: Player): void {
    this.challenges?.playerLeft(player.key);
  }

  /**
   * SQL task messages. Requests are checked against the game's rules first
   * (are you at the vault? is that the next lock?) and only then reach the
   * challenge system; a correct answer applies the reward.
   */
  private onChallenge(player: Player, message: JsonClientMessage, raw: unknown): void {
    if (message.t === 'interact') return;
    if (!this.challenges) {
      if (message.t === 'challenge_request')
        this.reply(player, this.refuse(message.ref, 'unavailable'));
      return;
    }
    if (message.t === 'challenge_request') {
      const rule = this.tasks.find(message.rewardKey);
      if (!rule) return this.reply(player, this.refuse(message.ref, 'unknown_reward'));
      const reason = rule.check(player, message.rewardKey, message.target);
      if (reason) return this.reply(player, this.refuse(message.ref, reason));
    }
    void this.challenges
      .handle(player.key, raw)
      .then((reply) => {
        if (reply.t === 'challenge_result' && reply.result.status === 'correct')
          this.tasks
            .find(reply.result.rewardKey)
            ?.grant(player, reply.result.rewardKey, reply.result.target);
        this.reply(player, reply);
      })
      .catch(() => this.reply(player, this.refuse(message.ref, 'unavailable')));
  }

  private refuse(ref: number, reason: RejectReason): ChallengeServerMessage {
    return { t: 'challenge', ref, now: this.now(), result: { ok: false, reason } };
  }

  /** Sends to the player unless they left while the answer was being graded. */
  private reply(player: Player, message: ChallengeServerMessage): void {
    if (this.match.getPlayer(player.id) === player) this.match.sendJson(player, message);
  }
}
