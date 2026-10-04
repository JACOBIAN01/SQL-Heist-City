import {
  ANCHOR_REACH_Y,
  DEFAULT_HEIST_SETTINGS,
  carrySpeedScale,
  jsonClientMessageSchema,
  mapWithClosedDoors,
  type ChallengeServerMessage,
  type HeistSettings,
  type JsonClientMessage,
  type RejectReason,
} from '@heist/shared';
import type { Player } from '../game/Player';
import { AmmoRule, GunRule, type ArmsControl } from './ArmsRules';
import { BankingService } from './BankingService';
import type { ChallengeGateway } from './ChallengeGateway';
import { HealRule } from './HealRule';
import { LootManager } from './LootManager';
import { ElevatorHandler } from './ElevatorHandler';
import { InteractionService } from './InteractionService';
import { RoundController } from './RoundController';
import { SafehouseHandler } from './SafehouseHandler';
import { TaskRules } from './TaskRule';
import { VaultConsoleHandler } from './VaultConsoleHandler';
import type { Vault } from './Vault';
import { VaultLockRule } from './VaultLockRule';
import { VaultRegistry } from './VaultRegistry';
import type { MatchApi } from './MatchApi';

/**
 * The heist rules of a match, behind the JSON messages. The match calls in;
 * this object decides what each message means and answers through MatchApi.
 * Pattern: Facade — Why: Match stays about movement and shooting; vaults,
 * loot and tasks grow here without touching the tick loop.
 */
export class HeistController implements ArmsControl {
  readonly interactions: InteractionService;
  readonly vaults: VaultRegistry;

  readonly tasks = new TaskRules();
  readonly loot = new LootManager();
  readonly banking: BankingService;
  /** The round clock and scoreboard; only on maps with vaults (the sandbox has no rounds). */
  readonly round: RoundController | undefined;

  constructor(
    private readonly match: MatchApi,
    readonly settings: HeistSettings = DEFAULT_HEIST_SETTINGS,
    private readonly challenges?: ChallengeGateway,
    private readonly now: () => number = Date.now,
  ) {
    this.vaults = new VaultRegistry(match.map, settings.locksPerVault);
    this.banking = new BankingService(match, settings.bankingSeconds, {
      complete: (player) => {
        const amount = player.cash;
        player.banked += amount;
        this.setCash(player, 0);
        return amount;
      },
    });
    this.interactions = new InteractionService(match)
      .register('safehouse', new SafehouseHandler(this.banking))
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
    this.tasks
      .add(new HealRule(match, settings))
      .add(new GunRule(match, this))
      .add(new AmmoRule(match, this));
    this.refreshDoors();
    if ((match.map.vaults?.length ?? 0) > 0) {
      this.round = new RoundController(match, settings, {
        allVaultsEmptied: () =>
          [...this.vaults.all()].every((v) => v.isOpen) && this.loot.count === 0,
        reset: () => this.resetWorld(),
        onEnd: () => this.banking.cancelAll('round_over'),
      });
    }
  }

  /** Whether the round is between rounds: nothing counts then. */
  get roundOver(): boolean {
    return this.round?.over ?? false;
  }

  /** Whether a new player may join now (not late in a round). */
  canJoin(): boolean {
    return this.round?.canJoin() ?? true;
  }

  /** A new round: vaults shut, bags gone, scores and players reset. */
  private resetWorld(): void {
    for (const v of this.vaults.all()) v.reset();
    this.refreshDoors();
    const gone = this.loot.clear();
    if (gone.length > 0) this.match.broadcastJson({ t: 'loot', add: [], remove: gone });
    this.match.broadcastJson({ t: 'vaults', vaults: this.vaults.views() });
    this.banking.cancelAll('round_over');
    this.match.resetPlayersForRound();
    for (const p of this.match.playerList()) {
      this.setCash(p, 0);
      this.sendArms(p);
    }
  }

  /** A player just joined: tell them where every vault stands. */
  onJoin(player: Player): void {
    this.match.sendJson(player, { t: 'vaults', vaults: this.vaults.views() });
    this.match.sendJson(player, { t: 'loot', add: this.loot.all(), remove: [] });
    this.sendPurse(player);
    this.sendArms(player);
    this.round?.onJoin(player);
  }

  /** Every tick: players walking over a bag pick it up. */
  onTick(): void {
    this.round?.onTick();
    if (!this.roundOver) this.banking.onTick();
    if (this.loot.count === 0) return;
    const reach = this.settings.bagPickupRadius;
    for (const bag of this.loot.all()) {
      const taker = this.match
        .playersNear(bag.x, bag.z, reach)
        .find((p) => p.alive && Math.abs(p.body.y - bag.y) <= ANCHOR_REACH_Y);
      if (!taker) continue;
      this.loot.remove(bag.id);
      this.setCash(taker, taker.cash + bag.amount);
      this.match.broadcastJson({ t: 'loot', add: [], remove: [bag.id] });
    }
  }

  /** A player died: what they carried drops where they fell. */
  onDeath(victim: Player, killer?: Player): void {
    this.banking.cancel(victim, 'died');
    if (killer && killer !== victim && killer.alive && this.settings.killBonus > 0)
      this.setCash(killer, killer.cash + this.settings.killBonus);
    if (victim.cash <= 0) return;
    const bag = this.loot.add(victim.body.x, victim.body.y, victim.body.z, victim.cash);
    this.setCash(victim, 0);
    this.match.broadcastJson({ t: 'loot', add: [bag], remove: [] });
  }

  /** A new life: empty hands again (or the sandbox rifle); tell the client. */
  onRespawn(player: Player): void {
    this.sendArms(player);
  }

  giveWeapon(player: Player, id: string): void {
    const spec = this.match.weaponSpec(id);
    if (!spec) return;
    player.giveWeapon(id, spec.magSize);
    this.sendArms(player);
  }

  refillAmmo(player: Player): void {
    const spec = this.match.weaponSpec(player.weaponId);
    if (spec && player.arsenal.has(player.weaponId))
      player.arsenal.set(player.weaponId, spec.magSize);
  }

  private sendArms(player: Player): void {
    this.match.sendJson(player, {
      t: 'arms',
      owned: [...player.arsenal.keys()],
      current: player.weaponId,
    });
  }

  /** A player took damage: it breaks their banking. */
  onDamaged(victim: Player): void {
    this.banking.cancel(victim, 'hurt');
  }

  /** The one place cash changes: keeps the speed penalty and the player's purse display in step. */
  setCash(player: Player, cash: number): void {
    player.cash = Math.max(0, Math.floor(cash));
    player.speedScale = carrySpeedScale(player.cash, this.settings);
    this.sendPurse(player);
  }

  private sendPurse(player: Player): void {
    this.match.sendJson(player, {
      t: 'purse',
      carried: player.cash,
      banked: player.banked,
      speed: player.speedScale,
    });
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
    if (vault.isOpen) this.spillLoot(vault);
    return true;
  }

  /** The last lock fell: the vault's cash lies in bags at its loot spots. */
  private spillLoot(vault: Vault): void {
    const spots = vault.spec.loot;
    const total = this.settings.vaultLootByTier[String(vault.spec.tier)] ?? 0;
    const bags = LootManager.split(total, spots.length).flatMap((amount, i) => {
      const spot = spots[i];
      return spot && amount > 0 ? [this.loot.add(spot.x, spot.y, spot.z, amount)] : [];
    });
    if (bags.length > 0) this.match.broadcastJson({ t: 'loot', add: bags, remove: [] });
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
        result: this.roundOver
          ? { action: 'denied', reason: 'round_over' }
          : this.interactions.use(player, message.anchor),
      });
      return;
    }
    if (message.t === 'equip') {
      if (player.alive && player.equip(message.weapon)) this.sendArms(player);
      return;
    }
    this.onChallenge(player, message, raw);
  }

  /** A player left: their challenge state goes with them. */
  onLeave(player: Player): void {
    this.challenges?.playerLeft(player.key);
    this.onDeath(player); // cash does not vanish with a disconnect
  }

  /**
   * SQL task messages. Requests are checked against the game's rules first
   * (are you at the vault? is that the next lock?) and only then reach the
   * challenge system; a correct answer applies the reward.
   */
  private onChallenge(player: Player, message: JsonClientMessage, raw: unknown): void {
    if (message.t === 'interact' || message.t === 'equip') return;
    if (this.roundOver && message.t === 'challenge_request')
      return this.reply(player, this.refuse(message.ref, 'not_allowed'));
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
        if (reply.t === 'challenge_hint' && reply.result.ok && reply.result.hint.charged)
          this.chargeHint(player, reply.result.hint.cost, reply.result.hint.costMode);
        if (reply.t === 'challenge_result' && reply.result.status === 'correct')
          this.tasks
            .find(reply.result.rewardKey)
            ?.grant(player, reply.result.rewardKey, reply.result.target);
        this.reply(player, reply);
      })
      .catch(() => this.reply(player, this.refuse(message.ref, 'unavailable')));
  }

  /** A hint costs carried cash (a fraction of it, or a fixed amount); never more than the player has. */
  private chargeHint(player: Player, cost: number, mode: 'fraction' | 'absolute'): void {
    const price = mode === 'fraction' ? Math.round(player.cash * cost) : Math.round(cost);
    if (price > 0) this.setCash(player, player.cash - Math.min(price, player.cash));
  }

  private refuse(ref: number, reason: RejectReason): ChallengeServerMessage {
    return { t: 'challenge', ref, now: this.now(), result: { ok: false, reason } };
  }

  /** Sends to the player unless they left while the answer was being graded. */
  private reply(player: Player, message: ChallengeServerMessage): void {
    if (this.match.getPlayer(player.id) === player) this.match.sendJson(player, message);
  }
}
