import {
  ANCHOR_REACH_Y,
  BANK_LAYOUTS,
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
import { ActsSystem } from './ActsSystem';
import { StorySystem } from './StorySystem';
import { CameraGrid } from './CameraGrid';
import { CopsRobbers } from './CopsRobbers';
import { GhostSystem } from './GhostSystem';
import { InsideMan } from './InsideMan';
import { SplitQueries } from './SplitQueries';
import { CityDb } from './CityDb';
import { IntelService } from './IntelService';
import { StoryVoice } from './StoryVoice';
import { DiscoverySystem } from './DiscoverySystem';
import { JobSystem } from './JobSystem';
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
      (p, bank) => this.acts.alertScale(p, bank),
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
    this.discovery = new DiscoverySystem(match, () => !this.taskOptions && !this.duels.enabled);
    // Side jobs: deliveries and street races from the districts' boards.
    this.jobs = new JobSystem(
      match,
      () => this.settings.jobs,
      new SeededRng(`jobs:${match.classInfo?.classId ?? 0}`),
      (player, amount) => this.setCash(player, player.cash + amount),
      () => !this.taskOptions && !this.duels.enabled,
      {
        grantIntel: (player, bank) => this.acts.grantIntel(player, bank),
        blind: (bank, seconds) => this.guards.blind(bank, seconds),
        crime: (player) => this.police.crime(player, 'lock'),
        spawnVip: (at) => this.spawnVip(at),
        removeVip: (vip) => this.match.removeNpc(vip),
        done: (player, kind) => this.events.publish({ type: 'job_done', player, kind }),
      },
    );
    // The inside man: a broken query of his, now and then, to fix for a tip.
    this.inside = new InsideMan(
      match,
      () => this.settings.insideMan,
      this.events,
      new SeededRng(`inside:${match.classInfo?.classId ?? 0}`),
      {
        calmGuards: (bank) => this.guards.calm(bank),
        pay: (player, amount) => this.setCash(player, player.cash + amount),
      },
      () => !this.taskOptions && !this.duels.enabled && !this.roundOver,
    );
    // Cops and robbers: some players are the police, and cops query a log of the robbers' trail.
    this.cops = new CopsRobbers(
      match,
      () => this.settings.copsRobbers,
      this.events,
      () => !this.taskOptions && !this.duels.enabled,
    );
    // The city database: live tables students query for intel, camera hacks and door control.
    this.cameras = new CameraGrid(match);
    this.cityDb = new CityDb({
      guards: () => this.guards.snapshot(),
      cameras: () => this.cameras.list(),
      cashDrops: () =>
        this.loot
          .all()
          .map((b) => ({ id: b.id, x: b.x, z: b.z, amount: b.amount, loose: b.loose === true })),
      wanted: () => this.bounties.list(),
      police: () => this.police.snapshot(),
      banks: () =>
        [...this.vaults.all()].map((v) => {
          const console_ = this.match.map.anchors?.find((a) => a.id === v.spec.consoleId);
          return {
            id: v.spec.bank,
            name: BANK_LAYOUTS.get(v.spec.tier)?.name ?? v.spec.bank,
            tier: v.spec.tier,
            locks: v.lockCount,
            opened: v.locksOpen,
            x: console_?.x ?? 0,
            z: console_?.z ?? 0,
          };
        }),
      trail: () => this.cops.trail(),
      doors: () =>
        [...this.vaults.all()].map((v) => ({
          id: v.spec.doorId,
          bank: v.spec.bank,
          locked: !v.isOpen,
        })),
    });
    this.intel = new IntelService(
      match,
      () => this.challenges?.city,
      this.cityDb,
      {
        switchOff: (bank, seconds) => {
          this.cameras.switchOff(bank, seconds);
          this.guards.blind(bank, seconds);
        },
        unlockNext: (player, bank) => this.unlockNext(player, bank),
      },
      () => !this.taskOptions && !this.duels.enabled && !this.roundOver,
      (p) => this.cops.teamOf(p),
    );
    // Co-op split queries: three squad-mates write one query between them.
    this.splits = new SplitQueries(
      match,
      () => this.challenges?.city,
      this.cityDb,
      {
        unlockNext: (player, bank) => this.unlockNext(player, bank),
        pay: (player, amount) => this.setCash(player, player.cash + amount),
      },
      () => !this.taskOptions && !this.duels.enabled && !this.roundOver,
    );
    // Ghost heists: your fastest run on a bank, to race.
    this.ghosts = new GhostSystem(
      match,
      this.events,
      () => !this.taskOptions && !this.duels.enabled && !this.roundOver,
    );
    // The story: a chain of steps for each bank, following what the match already does.
    this.story = new StorySystem(
      match,
      this.events,
      (player, amount) => this.setCash(player, player.cash + amount),
      () => !this.taskOptions && !this.duels.enabled,
    );
    // What the fixers say: scenes at the start and end of a chain, and a line at moments in a heist.
    this.voice = new StoryVoice(
      match,
      this.events,
      {
        settings: () => this.story.current(),
        chainOf: (p) => this.story.chainOf(p),
        stepsOf: (p, bank) => this.story.stepsOf(p, bank),
      },
      new SeededRng(`story:${match.classInfo?.classId ?? 0}`),
      () => !this.taskOptions && !this.duels.enabled,
    );
    this.story.onLoaded = (player) => this.voice.introFor(player);
    this.story.onChainDone = (player, chain) => {
      this.events.publish({
        type: 'chain_complete',
        player,
        bank: chain.bank,
        xp: chain.reward.xp,
      });
      this.voice.chainDone(player, chain);
    };
    // The three acts of a heist: intel at the terminal, the locks, the getaway.
    this.acts = new ActsSystem(
      match,
      () => this.settings.acts,
      this.events,
      () => this.settings.payout,
      (bank) =>
        this.guards
          .all()
          .filter((g) => this.guards.bankOf(g) === bank)
          .map((g) => ({ x: g.body.x, z: g.body.z })),
      () => !this.taskOptions && !this.duels.enabled,
    );
    // No police in the tutorial (its questions are fixed) or in a duel room.
    this.police = new PoliceSystem(
      match,
      () => this.settings.police,
      this.events,
      new SeededRng(`police:${match.classInfo?.classId ?? 0}`),
      () => !this.taskOptions && !this.duels.enabled,
      {
        levelOf: (p) => {
          const run = this.acts.runOf(p);
          return run ? this.acts.intelOf(p, run.bank) : 0;
        },
        // On the getaway the police guess the loot is making for the nearest safehouse.
        destination: (p) =>
          this.acts.runOf(p)?.act === 'getaway' ? this.nearestSafehouse(p) : undefined,
      },
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
      .register('job_board', this.jobs)
      .register('intel_terminal', this.acts)
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
      .add(new DuelRule(this.duels))
      .add(this.jobs)
      .add(this.acts)
      .add(this.inside);
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
    this.jobs.reset();
    this.acts.reset();
    this.intel.reset();
    this.cops.reset();
    this.ghosts.reset();
    this.inside.reset();
    this.splits.reset();
    this.cameras.reset();
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
    this.story.load(player);
    // A teacher's own heist opens with its story.
    const custom = this.match.classInfo?.mode.custom;
    if (custom)
      this.match.sendJson(player, {
        t: 'scene',
        id: `custom-${this.match.classInfo?.classId ?? 0}`,
        title: custom.story.title,
        lines: custom.story.lines,
      });
    this.cops.assign(player);
    this.cops.equip(player, (p) => this.giveWeapon(p, 'pistol'));
    this.match.sendJson(player, this.intel.catalog(player));
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
    this.discovery.onTick();
    this.jobs.onTick();
    this.acts.onTick();
    this.intel.onTick();
    this.cops.onTick();
    this.ghosts.onTick();
    this.inside.onTick();
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
      // A cop recovers cash for the score at once; a robber carries it.
      if (taker.isCop) taker.banked += bag.amount;
      else this.setCash(taker, taker.cash + bag.amount);
      this.events.publish({
        type: 'bag_taken',
        player: taker,
        amount: bag.amount,
        x: bag.x,
        z: bag.z,
      });
      this.match.broadcastJson({ t: 'loot', add: [], remove: [bag.id] });
    }
  }

  /** A player died: what they carried drops where they fell. */
  onDeath(victim: Player, killer?: Player): void {
    this.streaks.broke(victim.key);
    this.openTasks.delete(victim.key);
    this.banking.cancel(victim, 'died');
    this.police.clear(victim); // dying clears the record
    this.jobs.fail(victim);
    this.ghosts.drop(victim);
    this.acts.died(victim);
    if (victim.isPolice) {
      this.police.officerDown(victim, killer);
      return;
    }
    // An escort killed fails the contract and pays nobody.
    if (victim.isVip) {
      this.jobs.vipDown(victim);
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

  private nearestSafehouse(player: Player): { x: number; z: number } | undefined {
    let best: { x: number; z: number } | undefined;
    let bestD = Infinity;
    for (const a of this.match.map.anchors ?? []) {
      if (a.kind !== 'safehouse') continue;
      const d = Math.hypot(a.x - player.body.x, a.z - player.body.z);
      if (d < bestD) [best, bestD] = [a, d];
    }
    return best ? { x: best.x, z: best.z } : undefined;
  }

  /** A person to escort, standing at `at` on the street. */
  private spawnVip(at: { x: number; z: number }): Player | undefined {
    const vip = this.match.addGuard(
      'Escort',
      { x: at.x, z: at.z, yaw: 0 },
      0,
      this.settings.guards.weapon,
    );
    vip.isVip = true;
    return vip;
  }

  /** The door controller opens a vault's next lock for a player; false if there is nothing to open. */
  private unlockNext(player: Player, bank: string): boolean {
    const vault = [...this.vaults.all()].find((v) => v.spec.bank === bank);
    const lock = vault?.nextLock;
    return vault !== undefined && lock !== undefined && this.openLock(vault.spec.id, lock, player);
  }

  /** What a cop may use: lifts, and nothing to do with vaults, banking, intel or jobs. */
  private copMayUse(anchorId: string): boolean {
    const kind = this.match.map.anchors?.find((a) => a.id === anchorId)?.kind;
    return kind === 'elevator' || kind === 'shop';
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
    this.cops.equip(player, (p) => this.giveWeapon(p, 'pistol'));
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
    this.refreshSpeed(player);
    this.sendPurse(player);
  }

  /** Top speed from the cash carried, slowed while moving quietly. */
  private refreshSpeed(player: Player): void {
    const quiet = this.stealth.has(player) ? this.settings.approach.stealthSpeed : 1;
    player.speedScale = carrySpeedScale(player.cash, this.settings) * quiet;
  }

  /** The player chose to move quietly or loudly. */
  setApproach(player: Player, mode: 'loud' | 'stealth'): void {
    if (mode === 'stealth' && this.settings.approach.enabled) this.stealth.add(player);
    else this.stealth.delete(player);
    this.refreshSpeed(player);
    this.match.sendJson(player, {
      t: 'approach_state',
      mode: this.stealth.has(player) ? 'stealth' : 'loud',
    });
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
    // Quiet only if the cracker chose stealth and no guard or officer can see them.
    const quiet =
      by !== undefined &&
      this.settings.approach.enabled &&
      this.stealth.has(by) &&
      !this.guards.canSee(by) &&
      !this.police.canSee(by);
    vault.noteLock(quiet);
    const bonus =
      by && !quiet && this.settings.approach.enabled ? this.settings.approach.loudBonus : 0;
    if (by && bonus > 0) this.setCash(by, by.cash + bonus);
    this.refreshDoors();
    this.match.broadcastJson({ t: 'vaults', vaults: this.vaults.views() });
    this.events.publish({
      type: 'lock_opened',
      vault,
      lock,
      ...(by ? { player: by } : {}),
      ...(quiet ? { quiet: true } : {}),
      ...(bonus > 0 ? { bonus } : {}),
    });
    if (vault.isOpen) {
      const parts = this.spillLoot(vault, by);
      this.events.publish({ type: 'vault_opened', vault, ...(by ? { by } : {}), ...parts });
    }
    return true;
  }

  /** The last lock fell: the vault's cash lies in bags at its loot spots. */
  private spillLoot(
    vault: Vault,
    by?: Player,
  ): { base: number; ghostAmount: number; intelAmount: number } {
    const spots = vault.spec.loot;
    const base = this.settings.vaultLootByTier[String(vault.spec.tier)] ?? 0;
    // A ghost job (every lock quiet) pays more, and so does intel gathered on the bank (act one).
    const ghost = vault.ghost ? this.settings.approach.ghostBonus : 0;
    const intel = this.acts.lootBonus(by, `bank-${vault.spec.tier}`);
    const total = Math.round(base * (1 + ghost + intel));
    const bags = LootManager.split(total, spots.length).flatMap((amount, i) => {
      const spot = spots[i];
      return spot && amount > 0 ? [this.loot.add(spot.x, spot.y, spot.z, amount)] : [];
    });
    if (bags.length > 0) this.match.broadcastJson({ t: 'loot', add: bags, remove: [] });
    return {
      base,
      ghostAmount: Math.round(base * ghost),
      intelAmount: Math.round(base * intel),
    };
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
          : player.isCop && !this.copMayUse(message.anchor)
            ? ({ action: 'denied', reason: 'not_available' } as const) // cops do not rob
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
    if (message.t === 'split_submit') {
      void this.splits.submit(player, message).then((reply) => this.match.sendJson(player, reply));
      return;
    }
    if (message.t === 'city_query') {
      void this.intel.ask(player, message).then((reply) => this.match.sendJson(player, reply));
      return;
    }
    if (message.t === 'job_take') {
      this.jobs.take(player, message.board, message.kind);
      return;
    }
    if (message.t === 'approach') {
      this.setApproach(player, message.mode);
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
    this.discovery.forget(player);
    this.jobs.clear(player);
    this.acts.forget(player);
    this.story.forget(player);
    this.intel.forget(player);
    this.cops.forget(player);
    this.ghosts.drop(player);
    this.inside.forget(player);
    this.splits.forget(player);
    this.voice.forget(player);
    this.stealth.delete(player);
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
      message.t === 'approach' ||
      message.t === 'job_take' ||
      message.t === 'city_query' ||
      message.t === 'split_submit' ||
      message.t === 'role_pick'
    )
      return;
    if (
      message.t === 'challenge_request' &&
      player.isCop &&
      /^(vault|intel|job):/.test(message.rewardKey)
    )
      return this.reply(player, this.refuse(message.ref, 'not_allowed'));
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
  readonly discovery: DiscoverySystem;
  readonly jobs: JobSystem;
  readonly acts: ActsSystem;
  readonly story: StorySystem;
  readonly cops: CopsRobbers;
  readonly ghosts: GhostSystem;
  readonly inside: InsideMan;
  readonly splits: SplitQueries;
  readonly cameras: CameraGrid;
  readonly cityDb: CityDb;
  readonly intel: IntelService;
  readonly voice: StoryVoice;
  /** Who has chosen to break in quietly (Phase 30.7). */
  private readonly stealth = new Set<Player>();
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
