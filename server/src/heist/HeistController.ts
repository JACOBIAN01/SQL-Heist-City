import {
  ANCHOR_REACH_Y,
  DEFAULT_HEIST_SETTINGS,
  carrySpeedScale,
  SeededRng,
  streakBonus,
  jsonClientMessageSchema,
  mapWithClosedDoors,
  type ChallengeServerMessage,
  type HeistSettings,
  type JsonClientMessage,
  type SetLookMessage,
  type SkillAdjust,
  type RejectReason,
} from '@heist/shared';
import type { Player } from '../game/Player';
import { AmmoRule, GunRule, type ArmsControl } from './ArmsRules';
import { BankingService } from './BankingService';
import { BountyBoard } from './BountyBoard';
import { RoundAwards } from './RoundAwards';
import { StreakKeeper } from './StreakKeeper';
import { Squads } from './Squads';
import { DuelManager } from './DuelManager';
import { GuardSystem } from './GuardSystem';
import { PoliceSystem } from './PoliceSystem';
import { DuelRule } from './DuelRule';
import { FeedReporter } from './FeedReporter';
import { HeistEvents } from './HeistEvents';
import type { ChallengeGateway } from './ChallengeGateway';
import type { IssueOptions } from '../challenges/ChallengeService';
import { HealRule } from './HealRule';
import { LootManager } from './LootManager';
import { ElevatorHandler } from './ElevatorHandler';
import { InteractionService } from './InteractionService';
import { RoundController } from './RoundController';
import { CacheSystem } from './CacheSystem';
import { CollectibleSystem } from './CollectibleSystem';
import { ShopService } from './ShopService';
import { UpgradeSystem } from './UpgradeSystem';
import { SafehouseHandler } from './SafehouseHandler';
import { TaskRules } from './TaskRule';
import { PlanningRule } from './PlanningRule';
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
  /** The heist numbers in force; rewritten in place at each new round. */
  readonly settings: HeistSettings;
  readonly vaults: VaultRegistry;

  readonly tasks = new TaskRules();
  readonly loot = new LootManager();
  readonly banking: BankingService;
  /** What happened (locks, vaults, banking, bounties), for the feed and anyone else listening. */
  readonly events = new HeistEvents();
  readonly bounties: BountyBoard;
  /** Who did best at what this round, for the awards at its end. */
  readonly awards: RoundAwards;
  /** When each player's current question was issued (server clock), to time their answer. */
  private readonly issuedAt = new Map<string, number>();
  /** The round clock and scoreboard; only on maps with vaults (the sandbox has no rounds). */
  readonly round: RoundController | undefined;

  constructor(
    private readonly match: MatchApi,
    initial: HeistSettings = DEFAULT_HEIST_SETTINGS,
    private readonly challenges?: ChallengeGateway,
    private readonly now: () => number = Date.now,
    private readonly taskOptions?: (rewardKey: string) => IssueOptions | undefined,
    closedTiers: ReadonlySet<number> = new Set(),
  ) {
    // Our own copy: `refreshSettings` rewrites it in place, and every rule holding it sees the change.
    this.settings = { ...initial };
    this.closedTiers = closedTiers;
    const settings = this.settings;
    this.vaults = new VaultRegistry(match.map, settings.locksPerVault);
    this.vaults.closeTiers(closedTiers);
    new FeedReporter(match, this.events);
    this.events.subscribe((event) => {
      if (event.type === 'round_end') this.streaks.reset();
    });
    this.squads = new Squads(
      match,
      () => this.settings.squadNames,
      () => this.settings.roles,
      this.events,
      (player) => this.openTasks.get(player.key),
    );
    this.squads.configure(match.classInfo);
    this.guards = new GuardSystem(
      match,
      () => this.settings.guards,
      this.events,
      new SeededRng(`guards:${match.classInfo?.classId ?? 0}`),
    );
    // Hidden caches in a city room only (the tutorial has no city, a duel room has no loot).
    this.caches = new CacheSystem(
      match,
      () => this.settings.caches,
      new SeededRng(`caches:${match.classInfo?.classId ?? 0}`),
      (player, amount) => this.setCash(player, player.cash + amount),
      () => !this.taskOptions && !this.duels.enabled,
      (p) => this.upgrades.intelRange(p),
    );
    // Collectible chips: the same places in every round of this city.
    this.collectibles = new CollectibleSystem(
      match,
      () => this.settings.collectibles,
      () => new SeededRng(`chips:${match.map.city?.settings.seed ?? 'none'}`),
      (player, amount) => this.setCash(player, player.cash + amount),
      () => !this.taskOptions && !this.duels.enabled,
      (p) => this.upgrades.intelRange(p),
    );
    // No police in the tutorial (its questions are fixed) or in a duel room.
    this.police = new PoliceSystem(
      match,
      () => this.settings.police,
      this.events,
      new SeededRng(`police:${match.classInfo?.classId ?? 0}`),
      () => !this.taskOptions && !this.duels.enabled,
    );
    this.duels = new DuelManager(
      match,
      () => (match.classInfo?.mode.kind === 'duel' ? match.classInfo.mode.duel : undefined),
      this.events,
      `${match.classInfo?.classId ?? 0}-${Date.now()}`,
      () => this.challenges,
    );
    this.bounties = new BountyBoard(match, settings, this.events);
    this.awards = new RoundAwards(this.events);
    this.banking = new BankingService(
      match,
      () => this.settings.bankingSeconds,
      {
        complete: (player) => {
          const amount = player.cash;
          player.banked += amount;
          this.setCash(player, 0);
          if (amount > 0) this.events.publish({ type: 'banked', player, amount });
          return amount;
        },
      },
      (p) => this.upgrades.bankingScale(p),
    );
    this.upgrades = new UpgradeSystem(
      match,
      () => this.settings.upgrades,
      (p, id, result) => this.shop.send(p, undefined, id && result ? { id, ...result } : undefined),
      (p) => this.applyUpgrades(p),
    );
    this.shop = new ShopService({
      match,
      settings: () => this.settings.shop,
      setCash: (p, cash) => this.setCash(p, cash),
      refillAmmo: (p) => this.refillAmmo(p),
      upgradeOffers: (p) => this.upgrades.offers(p),
    });
    this.interactions = new InteractionService(match)
      .register('safehouse', new SafehouseHandler(this.banking))
      .register('shop', this.shop)
      .register('elevator', new ElevatorHandler())
      .register('vault_console', new VaultConsoleHandler(this.vaults));
    this.tasks.add(
      new VaultLockRule(this.vaults, match, (id, lock, by) => this.openLock(id, lock, by), {
        onSolved: (player, vaultId, lock, opened) => {
          if (!opened)
            this.match.sendJson(player, { t: 'notice', text: 'Someone opened that lock first.' });
        },
      }),
    );
    this.tasks
      .add(new HealRule(match, settings))
      .add(new GunRule(match, this))
      .add(new AmmoRule(match, this))
      .add(new PlanningRule(settings, () => this.roundOver))
      .add(new DuelRule(this.duels));
    this.refreshDoors();
    if ((match.map.vaults?.length ?? 0) > 0) {
      this.round = new RoundController(match, settings, {
        // A duel room has no vaults to empty: its round runs for its whole length.
        allVaultsEmptied: () =>
          !this.duels.enabled &&
          [...this.vaults.all()].every((v) => v.isOpen || v.closed) &&
          this.loot.stakes === 0,
        reset: () => this.resetWorld(),
        squadTable: () => (this.squads.enabled ? this.squads.table() : undefined),
        squadAwards: () => this.squads.awards(),
        awards: () => this.awards.results((id) => this.match.getPlayer(id)),
        onEnd: () => this.banking.cancelAll('round_over'),
        onResult: (result) => this.events.publish({ type: 'round_end', result }),
      });
      this.layLooseCash();
    }
  }

  /**
   * Takes the admin's current heist numbers (between rounds). The settings
   * object is rewritten in place because the rules hold a reference to it.
   */
  refreshSettings(next: HeistSettings): void {
    Object.assign(this.settings, next);
    this.vaults.setLockCount(next.locksPerVault);
  }

  private closedTiers: ReadonlySet<number> = new Set();
  /** How to ease a student's questions; set by the learning record when there is one. */
  skillOf: ((player: Player) => SkillAdjust | undefined) | undefined;
  /** The student's weakest topics, for spaced repetition. */
  focusOf: ((player: Player) => readonly string[] | undefined) | undefined;
  /** A player asked to wear (or take off) a cosmetic; their progress decides (Phase 26.3). */
  onLook: ((player: Player, message: SetLookMessage) => void) | undefined;

  /** The teacher's class closed these banks: no locks, no loose cash, and the round does not wait for them. */
  setClosedTiers(tiers: ReadonlySet<number>): void {
    this.closedTiers = tiers;
    this.vaults.closeTiers(tiers);
  }

  /** Loose cash on the offices' desks (12.1): laid out again every round, by the bank's tier. */
  private layLooseCash(): void {
    const piles = (this.match.map.cashSpots ?? []).flatMap((c) => {
      if (this.closedTiers.has(c.tier)) return [];
      const amount = this.settings.looseCashByTier[String(c.tier)] ?? 0;
      return amount > 0 ? [this.loot.add(c.x, c.y, c.z, amount, true)] : [];
    });
    if (piles.length > 0) this.match.broadcastJson({ t: 'loot', add: piles, remove: [] });
  }

  /** Teacher controls: end the round now / begin the next one now. */
  endRound(): void {
    this.round?.endNow();
  }

  startNextRound(): void {
    this.round?.startNow();
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
    this.squads.reset();
    this.duels.reset();
    this.guards.reset();
    this.police.reset();
    this.caches.reset();
    this.match.refreshWorld();
    for (const v of this.vaults.all()) v.reset();
    this.bounties.forget();
    this.awards.reset();
    this.refreshDoors();
    const gone = this.loot.clear();
    if (gone.length > 0) this.match.broadcastJson({ t: 'loot', add: [], remove: gone });
    this.layLooseCash();
    this.match.broadcastJson({ t: 'vaults', vaults: this.vaults.views() });
    this.banking.cancelAll('round_over');
    this.match.refreshCombat();
    this.match.resetPlayersForRound();
    for (const p of this.match.playerList()) {
      this.setCash(p, 0);
      this.sendArms(p);
    }
  }

  /** A player just joined: tell them the guns' numbers and where every vault stands. */
  onJoin(player: Player): void {
    this.squads.place(player);
    this.upgrades.load(player);
    this.squads.send(player);
    this.duels.onJoin(player);
    this.match.sendJson(player, { t: 'weapons', weapons: this.match.weapons });
    this.match.sendWorld(player);
    this.match.sendJson(player, { t: 'vaults', vaults: this.vaults.views() });
    this.match.sendJson(player, { t: 'loot', add: this.loot.all(), remove: [] });
    this.sendPurse(player);
    this.sendArms(player);
    this.bounties.post(player);
    this.round?.onJoin(player);
  }

  /** Every tick: players walking over a bag pick it up. */
  onTick(): void {
    this.round?.onTick();
    this.squads.onTick();
    this.duels.onTick();
    this.guards.onTick();
    this.police.onTick();
    this.caches.onTick();
    this.collectibles.onTick();
    if (!this.roundOver) {
      this.banking.onTick();
      this.bounties.onTick();
    }
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
    this.streaks.broke(victim.key);
    this.openTasks.delete(victim.key);
    this.banking.cancel(victim, 'died');
    this.police.clear(victim); // dying clears the record
    if (victim.isPolice) {
      this.police.officerDown(victim, killer);
      return;
    }
    // A guard brought down pays whoever did it, and drops nothing.
    if (victim.isGuard) {
      if (killer) this.police.crime(killer, 'guard');
      if (killer && !killer.isDummy && killer.alive)
        this.setCash(killer, killer.cash + this.settings.guards.killBonus);
      return;
    }
    this.challenges?.playerDied?.(victim.key); // an open question ends with the life
    // The killer of a wanted player collects the bounty on top of the kill bonus.
    if (killer && killer !== victim && !victim.isDummy)
      this.events.publish({ type: 'kill', killer, victim });
    const bounty = this.bounties.claim(victim, killer);
    const earned =
      (killer && killer !== victim && killer.alive ? this.settings.killBonus : 0) + bounty;
    if (killer && earned > 0) this.setCash(killer, killer.cash + earned);
    if (victim.cash <= 0) return;
    // A safehouse stash upgrade keeps a share of what they carried.
    const kept = Math.floor(victim.cash * this.upgrades.stashShare(victim));
    const bag = this.loot.add(victim.body.x, victim.body.y, victim.body.z, victim.cash - kept);
    this.setCash(victim, kept);
    this.match.broadcastJson({ t: 'loot', add: [bag], remove: [] });
  }

  /** Spawn armour from the safehouse upgrade; never takes armour away. */
  private applyUpgrades(player: Player): void {
    if (!player.alive || player.isGuard) return;
    const armour = this.upgrades.spawnArmour(player);
    if (armour > player.armour) {
      player.armour = Math.min(this.settings.shop.armourMax, armour);
      this.shop.send(player);
    }
  }

  /** A new life: empty hands again (or the sandbox rifle); tell the client. */
  onRespawn(player: Player): void {
    this.applyUpgrades(player);
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
  openLock(vaultId: string, lock: number, by?: Player): boolean {
    const vault = this.vaults.get(vaultId);
    if (!vault || vault.openLock(lock) !== 'opened') return false;
    this.refreshDoors();
    this.match.broadcastJson({ t: 'vaults', vaults: this.vaults.views() });
    this.events.publish({ type: 'lock_opened', vault, lock, ...(by ? { player: by } : {}) });
    if (vault.isOpen) {
      this.spillLoot(vault);
      this.events.publish({ type: 'vault_opened', vault });
    }
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
    if (!parsed.success) {
      this.match.reportAnomaly(player, 'malformed', { t: (raw as { t?: unknown } | null)?.t });
      return;
    }
    const message = parsed.data;
    if (message.t === 'interact') {
      const result = this.roundOver
        ? ({ action: 'denied', reason: 'round_over' } as const)
        : player.vehicleId !== 0
          ? ({ action: 'denied', reason: 'not_available' } as const) // no banking or lifts from a car
          : this.interactions.use(player, message.anchor);
      // The client only offers F within reach of a real anchor.
      if (
        result.action === 'denied' &&
        (result.reason === 'too_far' || result.reason === 'unknown_anchor')
      )
        this.match.reportAnomaly(player, 'impossible_action', {
          interact: message.anchor,
          reason: result.reason,
        });
      this.match.sendJson(player, {
        t: 'interact_result',
        ref: message.ref,
        anchor: message.anchor,
        result,
      });
      return;
    }
    if (message.t === 'vehicle') {
      this.match.sendJson(player, this.match.vehicleRequest(player, message));
      return;
    }
    if (message.t === 'upgrade_buy') {
      this.upgrades.buy(player, message.upgrade);
      return;
    }
    if (message.t === 'shop_buy') {
      this.shop.buy(player, message.item);
      return;
    }
    if (message.t === 'squad_join') {
      const result = this.squads.pick(player, message.squad);
      this.squads.send(player, result === 'ok' ? undefined : result);
      return;
    }
    if (message.t === 'role_pick') {
      const result = this.squads.pickRole(player, message.role);
      this.squads.send(player, result === 'ok' ? undefined : result);
      return;
    }
    if (message.t === 'set_look') {
      this.onLook?.(player, message);
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
    this.openTasks.delete(player.key);
    this.duels.onLeave(player);
    this.police.clear(player);
    this.caches.forget(player);
    this.upgrades.forget(player);
    this.collectibles.forget(player);
    this.challenges?.playerLeft(player.key);
    this.issuedAt.delete(player.key);
    this.onDeath(player); // cash does not vanish with a disconnect
  }

  /**
   * SQL task messages. Requests are checked against the game's rules first
   * (are you at the vault? is that the next lock?) and only then reach the
   * challenge system; a correct answer applies the reward.
   */
  private onChallenge(player: Player, message: JsonClientMessage, raw: unknown): void {
    if (
      message.t === 'interact' ||
      message.t === 'equip' ||
      message.t === 'set_look' ||
      message.t === 'squad_join' ||
      message.t === 'shop_buy' ||
      message.t === 'upgrade_buy' ||
      message.t === 'role_pick'
    )
      return;
    if (message.t === 'challenge_request' && !this.tasks.find(message.rewardKey)) {
      this.match.reportAnomaly(player, 'impossible_action', { task: message.rewardKey });
      return this.reply(player, this.refuse(message.ref, 'unknown_reward'));
    }
    if (
      this.roundOver &&
      message.t === 'challenge_request' &&
      !this.tasks.find(message.rewardKey)?.betweenRounds
    )
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
    const base =
      message.t === 'challenge_request' ? this.taskOptions?.(message.rewardKey) : undefined;
    // A duel's question is the same for both sides (and from the class's whole released set).
    const duel =
      message.t === 'challenge_request' && message.rewardKey === 'duel:draw'
        ? this.duels.optionsFor(player)
        : undefined;
    // Whose attempt this is, for the learning record.
    // A struggling student gets easier questions and more time (and smaller heals) for this task.
    const skill = message.t === 'challenge_request' ? this.skillOf?.(player) : undefined;
    const focusTopics = message.t === 'challenge_request' ? this.focusOf?.(player) : undefined;
    if (message.t === 'challenge_request') player.healScale = skill?.rewardScale ?? 1;
    const options =
      message.t === 'challenge_request'
        ? {
            ...base,
            ...duel,
            ...(skill ? { skill } : {}),
            ...(focusTopics?.length ? { focusTopics } : {}),
            who: {
              ...(player.accountId === undefined ? {} : { accountId: player.accountId }),
              ...(this.match.classInfo ? { classId: this.match.classInfo.classId } : {}),
              ...(this.round ? { round: this.round.number } : {}),
            },
          }
        : undefined;
    void this.challenges
      .handle(player.key, raw, options)
      .then((reply) => {
        if (reply.t === 'challenge_hint' && reply.result.ok && reply.result.hint.charged)
          this.chargeHint(player, reply.result.hint.cost, reply.result.hint.costMode);
        if (reply.t === 'challenge' && reply.result.ok) {
          this.issuedAt.set(player.key, reply.now);
          this.openTasks.set(player.key, reply.result.challenge.rewardKey);
        }
        if (reply.t === 'challenge_abandoned') this.openTasks.delete(player.key);
        if (reply.t === 'challenge_result' && reply.result.status === 'wrong')
          this.streaks.broke(player.key);
        if (reply.t === 'challenge_result' && reply.result.status === 'correct') {
          const { rewardKey, target } = reply.result;
          this.tasks.find(rewardKey)?.grant(player, rewardKey, target);
          this.openTasks.delete(player.key);
          if (!rewardKey.startsWith('duel:')) this.payStreak(player);
          const issued = this.issuedAt.get(player.key);
          this.issuedAt.delete(player.key);
          this.events.publish({
            type: 'task_solved',
            player,
            rewardKey,
            ...(issued !== undefined ? { seconds: Math.max(0, (reply.now - issued) / 1000) } : {}),
          });
        }
        this.reply(player, reply);
      })
      .catch(() => this.reply(player, this.refuse(message.ref, 'unavailable')));
  }

  readonly caches: CacheSystem;
  readonly collectibles: CollectibleSystem;
  readonly shop: ShopService;
  readonly upgrades: UpgradeSystem;
  private readonly streaks = new StreakKeeper();
  /** The reward each player has open in the SQL pop-up (shown to their squad). */
  private readonly openTasks = new Map<string, string>();
  /** Squads of a class room (Phase 27). */
  readonly squads: Squads;
  /** Bank guards (Phase 29.3). */
  readonly guards: GuardSystem;
  /** The police (Phase 29.4). */
  readonly police: PoliceSystem;
  /** SQL Quick Draw duels, in a class whose mode is the duel kind (Phase 28.3). */
  readonly duels: DuelManager;

  /**
   * A correct answer: a clean one (right at the first go) lengthens the player's run and pays the
   * bonus from the minimum on; one that took wrong tries ends it. The tutorial pays nothing.
   */
  private payStreak(player: Player): void {
    if (this.taskOptions) return;
    const run = this.streaks.solved(player.key);
    const bonus = streakBonus(run, this.settings);
    if (bonus <= 0) return;
    this.setCash(player, player.cash + bonus);
    this.match.sendJson(player, {
      t: 'notice',
      text: `Streak ×${run}: +$${bonus.toLocaleString('en-US')}`,
    });
  }

  /** A hint costs carried cash (a fraction of it, or a fixed amount); never more than the player has. */
  private chargeHint(player: Player, cost: number, mode: 'fraction' | 'absolute'): void {
    const raw = mode === 'fraction' ? player.cash * cost : cost;
    const price = Math.round(raw * this.squads.hintScale(player));
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
