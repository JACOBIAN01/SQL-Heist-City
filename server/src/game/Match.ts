import {
  Button,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_MOVEMENT_SETTINGS,
  DEFAULT_VEHICLE_SETTINGS,
  colliderGridFor,
  controlsOf,
  distanceToCar,
  exitSpots,
  Flag,
  PROTOCOL_VERSION,
  SIM_DT,
  aimDirectionInto,
  aimOriginInto,
  newShotResult,
  bodyHeight,
  createBody,
  encodeBundle,
  encodeServerMessage,
  flagsWithWeapon,
  hasButton,
  resolveShotInto,
  stepBody,
  pushBodyOutOfCars,
  damageAt,
  spreadFor,
  type CombatSettings,
  type EntityState,
  type GameEvent,
  type GameMap,
  type HeistSettings,
  type InputCommand,
  type JsonServerMessage,
  type MatchSettings,
  type MovementSettings,
  type ServerMessage,
  type ShotTarget,
  type SelfState,
  type SnapshotMessage,
  type WeaponSpec,
  type SpawnPoint,
  type Aabb,
  type VehicleMessage,
  type VehicleReply,
  type VehicleSettings,
  type VehicleWire,
} from '@heist/shared';
import { VehicleFleet, type Vehicle } from './VehicleFleet';
import type { ChallengeGateway } from '../heist/ChallengeGateway';
import { HeistController } from '../heist/HeistController';
import type { MatchApi } from '../heist/MatchApi';
import { InterestManager } from './InterestManager';
import { LagCompensator, type BodyPose } from './LagCompensator';
import { Player, type PlayerConnection } from './Player';
import { ShotRng } from './ShotRng';
import { FarthestSpawnPolicy, type SpawnPolicy } from './SpawnPolicy';

export const CLOSE_PROTOCOL = 4000;
export const CLOSE_FULL = 4001;
export const CLOSE_IDLE = 4002;
export const CLOSE_ROUND = 4003;

/** The snapshot scratch objects are written in place, so they are not readonly here. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type JoinResult =
  | { readonly ok: true; readonly player: Player }
  | { readonly ok: false; readonly code: number; readonly reason: string };

export interface MatchDeps {
  readonly map: GameMap;
  readonly settings: MatchSettings;
  readonly movement?: MovementSettings;
  readonly combat?: CombatSettings;
  /** Where to read combat settings again at each new round (admin edits); none keeps `combat`. */
  readonly combatSource?: () => CombatSettings;
  readonly heist?: HeistSettings;
  readonly vehicles?: VehicleSettings;
  /** SQL tasks; without it every task request is answered "unavailable". */
  readonly challenges?: ChallengeGateway;
  /** Starts every player key (`p1`, `p2`…), so matches sharing one challenge system never share a key. */
  readonly keyPrefix?: string;
  /** Seeds bullet spread so a match is reproducible in tests. */
  readonly seed?: string;
  readonly spawnPolicy?: SpawnPolicy;
  /** Wall-clock ms (idle timeouts only; the simulation runs on ticks). */
  readonly now?: () => number;
}

const MAX_ID = 0xffff;

/**
 * One running match: who is in it and what happens each tick. It knows
 * nothing about WebSockets — connections come in as `PlayerConnection`.
 */
export class Match implements MatchApi {
  readonly players = new Map<number, Player>();
  tick = 0;
  /** Everything the server has tried to send, for `/metrics` and the load tests. */
  readonly traffic = { bytes: 0, snapshots: 0, events: 0 };
  private nextId = 1;
  private joinCount = 0;
  private readonly spawnPolicy: SpawnPolicy;
  private readonly now: () => number;
  private readonly movement: MovementSettings;
  private combat: CombatSettings;
  /** The heist rules (vaults, loot, tasks); public so tests and tools can drive them. */
  readonly heist: HeistController;
  /** Every car in the match; the server drives them (docs/gameplay.md "Vehicles"). */
  readonly vehicles: VehicleFleet;
  private readonly vehicleScratch: VehicleWire[] = [];
  private readonly vehicleRemoved: number[] = [];
  private readonly inRange = new Set<number>();
  private readonly nearBoxes: Aabb[] = [];
  /** The map as it stands (open vault doors change it); the base map is `deps.map`. */
  private collisionMap: GameMap;
  /** The map as the respawn picker sees it: hospital spots in place of street spawns, when there are any. */
  private readonly respawnMap: GameMap;
  private readonly lagComp: LagCompensator;
  private readonly interest: InterestManager;
  // Scratch space reused by every snapshot: nothing here is allocated per tick.
  private readonly scratchIds: number[] = [];
  private readonly scratchRemoved: number[] = [];
  private readonly entityPool: Mutable<EntityState>[] = [];
  private readonly snapshotCounts = { entities: 0, removed: 0, vehicles: 0, vehiclesRemoved: 0 };
  private readonly snapshotMessage: Mutable<SnapshotMessage>;
  private readonly positionOf = (id: number) => this.players.get(id)?.body;
  // Shot scratch: a tick can fire dozens of bullets and none of this is allocated per shot.
  private readonly shotRng = new ShotRng();
  private readonly seedNumber: number;
  private readonly aimFrom = { x: 0, y: 0, z: 0 };
  private readonly aimDir = { x: 0, y: 0, z: 0 };
  private readonly shotResult = newShotResult();
  private readonly shotTargets: Mutable<ShotTarget>[] = [];
  private readonly nearShooter: number[] = [];
  private readonly rewound: BodyPose = { x: 0, y: 0, z: 0, height: 0 };
  private shotEvent: Extract<GameEvent, { e: 'shot' }> | undefined;
  private shotBytes: Uint8Array = new Uint8Array(0);
  private shotStamp = 0;
  private readonly bundleParts: Uint8Array[] = [];
  private shotTargetCount = 0;
  private shotRange = 0;

  constructor(private readonly deps: MatchDeps) {
    this.collisionMap = deps.map;
    this.respawnMap = deps.map.respawns ? { ...deps.map, spawns: deps.map.respawns } : deps.map;
    this.movement = deps.movement ?? DEFAULT_MOVEMENT_SETTINGS;
    this.combat = deps.combat ?? DEFAULT_COMBAT_SETTINGS;
    this.interest = new InterestManager(deps.settings.interest);
    this.seedNumber = hashString(deps.seed ?? 'match');
    this.snapshotMessage = {
      t: 'snapshot',
      tick: 0,
      ackSeq: 0,
      self: {
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        flags: 0,
        hp: 0,
        weapon: 0,
        ammo: 0,
        vehicle: 0,
      },
      entities: this.entityPool,
      removed: this.scratchRemoved,
      vehicles: this.vehicleScratch,
      vehiclesRemoved: this.vehicleRemoved,
    };
    // A bit more history than the rewind cap, so the oldest legal rewind is always covered.
    this.lagComp = new LagCompensator(
      Math.ceil((this.combat.maxLagCompMs / 1000) * deps.settings.tickRate) + 4,
    );
    this.spawnPolicy = deps.spawnPolicy ?? new FarthestSpawnPolicy();
    this.now = deps.now ?? Date.now;
    this.vehicles = new VehicleFleet(deps.map, deps.vehicles ?? DEFAULT_VEHICLE_SETTINGS);
    this.heist = new HeistController(this, deps.heist, deps.challenges);
  }

  get map(): GameMap {
    return this.deps.map;
  }

  get settings(): MatchSettings {
    return this.deps.settings;
  }

  get tickRate(): number {
    return this.deps.settings.tickRate;
  }

  get maxHp(): number {
    return this.combat.maxHp;
  }

  weaponSpec(id: string): WeaponSpec | undefined {
    return this.combat.weapons[id];
  }

  /** Every gun's numbers, as clients need them to predict fire and draw what they see. */
  get weapons(): CombatSettings['weapons'] {
    return this.combat.weapons;
  }

  /**
   * Picks up combat settings the admin changed, between rounds, and tells
   * every client. The lag-compensation window stays as the match started
   * (it sized the position history).
   */
  refreshCombat(): void {
    const next = this.deps.combatSource?.();
    if (!next) return;
    this.combat = { ...next, maxLagCompMs: this.combat.maxLagCompMs };
    this.broadcastJson({ t: 'weapons', weapons: this.combat.weapons });
  }

  get unarmedStart(): boolean {
    return this.deps.map.unarmedStart === true;
  }

  getPlayer(id: number): Player | undefined {
    return this.players.get(id);
  }

  playerList(): Iterable<Player> {
    return this.players.values();
  }

  playersNear(x: number, z: number, radius: number): Player[] {
    const ids: number[] = [];
    const found = this.interest.grid.collectNear(x, z, radius, ids);
    const out: Player[] = [];
    for (let i = 0; i < found; i++) {
      const p = this.players.get(ids[i] as number);
      if (p && Math.hypot(p.body.x - x, p.body.z - z) <= radius) out.push(p);
    }
    return out;
  }

  sendJson(player: Player, message: JsonServerMessage): void {
    if (player.isDummy) return;
    this.sendTo(player, { t: 'json', text: JSON.stringify(message) });
  }

  setCollisionMap(map: GameMap): void {
    this.collisionMap = map;
  }

  broadcastJson(message: JsonServerMessage): void {
    const text = JSON.stringify(message);
    for (const p of this.players.values()) if (!p.isDummy) this.sendTo(p, { t: 'json', text });
  }

  resetPlayersForRound(): void {
    // Everyone on foot again and every car back in its spot.
    for (const p of this.players.values()) p.vehicleId = 0;
    this.vehicles.reset();
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      p.banked = 0;
      p.cash = 0;
      p.speedScale = 1;
      p.rank = 0;
      p.rankedOf = 0;
      p.hp = this.combat.maxHp;
      p.alive = true;
      p.cooldown = 0;
      const spawn =
        p.home ??
        this.spawnPolicy.pick(
          this.deps.map,
          [...this.players.values()].filter((o) => o !== p && o.alive).map((o) => o.body),
        );
      this.lagComp.forget(p.id);
      Object.assign(p.body, createBody(spawn.x, 0, spawn.z));
      p.yaw = spawn.yaw;
      this.equipStartingGear(p, p.isDummy);
      p.protectedUntilTick = p.isDummy
        ? 0
        : this.tick + this.ticksFor(this.combat.spawnProtectionSec);
    }
  }

  teleport(player: Player, x: number, y: number, z: number): void {
    Object.assign(player.body, createBody(x, y, z));
    this.interest.update(player.id, x, z);
  }

  /** A JSON frame from a client (SQL tasks, interactions); ignored if the player is gone. */
  receiveJson(id: number, text: string): void {
    const player = this.players.get(id);
    if (!player) return;
    player.lastHeardAt = this.now();
    this.heist.onJson(player, text);
  }

  join(protocol: number, rawName: string, connection: PlayerConnection): JoinResult {
    if (protocol !== PROTOCOL_VERSION) {
      return { ok: false, code: CLOSE_PROTOCOL, reason: 'Client is out of date, reload the page' };
    }
    if (this.players.size >= this.deps.settings.maxPlayers) {
      return { ok: false, code: CLOSE_FULL, reason: 'Match is full' };
    }
    if (!this.heist.canJoin()) {
      return {
        ok: false,
        code: CLOSE_ROUND,
        reason: 'This round is under way. Join the next one.',
      };
    }
    const id = this.allocateId();
    const key = `${this.deps.keyPrefix ?? ''}p${++this.joinCount}`;
    const spawn = this.spawnPolicy.pick(
      this.deps.map,
      [...this.players.values()].map((p) => p.body),
    );
    const player = new Player(
      id,
      cleanName(rawName, id),
      connection,
      spawn,
      this.now(),
      this.combat.maxHp,
    );
    player.key = key;
    this.equipStartingGear(player);
    player.protectedUntilTick = this.tick + this.ticksFor(this.combat.spawnProtectionSec);
    this.players.set(id, player);

    this.sendTo(player, {
      t: 'welcome',
      playerId: id,
      tick: this.tick,
      tickRate: this.deps.settings.tickRate,
      mapId: this.deps.map.id,
    });
    // Tell the newcomer who is already here, and everyone else about the newcomer.
    for (const other of this.players.values()) {
      if (other.id === id) continue;
      this.sendTo(player, { t: 'event', event: { e: 'joined', id: other.id, name: other.name } });
    }
    this.broadcast({ e: 'joined', id, name: player.name }, id);
    this.heist.onJoin(player);
    return { ok: true, player };
  }

  /**
   * What a player holds at the start of a life: nothing on heist maps (guns
   * are earned with SQL), the sandbox rifle with endless ammo elsewhere.
   */
  private equipStartingGear(player: Player, alwaysArmed = false): void {
    player.disarm();
    if (this.deps.map.unarmedStart && !alwaysArmed) return;
    const id = this.combat.sandboxWeapon;
    player.infiniteAmmo = true;
    player.giveWeapon(id, this.combat.weapons[id]?.magSize ?? 0);
  }

  /** Adds a stationary target (sandbox only). It has no connection and is never idle-dropped. */
  addDummy(name: string, spot: SpawnPoint): Player {
    const quiet: PlayerConnection = { send: () => {}, close: () => {} };
    const player = new Player(this.allocateId(), name, quiet, spot, this.now(), this.combat.maxHp);
    this.equipStartingGear(player, true);
    player.isDummy = true;
    player.home = spot;
    this.players.set(player.id, player);
    this.broadcast({ e: 'joined', id: player.id, name }, player.id);
    return player;
  }

  leave(id: number): void {
    const leaving = this.players.get(id);
    if (!leaving || !this.players.delete(id)) return;
    this.releaseVehicle(leaving);
    this.heist.onLeave(leaving);
    this.lagComp.forget(id);
    this.interest.remove(id);
    this.broadcast({ e: 'left', id });
  }

  /** Called with decoded input; applied on the next tick. */
  receiveInput(id: number, commands: readonly InputCommand[]): void {
    const player = this.players.get(id);
    if (!player) return;
    player.lastHeardAt = this.now();
    player.enqueue(commands, this.deps.settings.inputQueueLimit);
  }

  /** Marks the client as alive without carrying game data (ping, keep-alives). */
  touch(id: number): void {
    const player = this.players.get(id);
    if (player) player.lastHeardAt = this.now();
  }

  /** One authoritative step: simulate, then send each player their view. */
  step(): void {
    this.tick++;
    this.dropIdlePlayers();
    this.respawnDue();
    // Positions can change outside movement (respawns, joins): refresh the grid before shots use it.
    for (const p of this.players.values()) this.interest.update(p.id, p.body.x, p.body.z);
    for (const player of this.players.values()) this.applyInput(player);
    this.vehicles.coast(this.collisionMap, 1 / this.deps.settings.tickRate);
    this.vehicles.settle();
    // Drivers sit exactly where their (settled) car is.
    for (const player of this.players.values()) {
      const car = player.vehicleId ? this.vehicles.get(player.vehicleId) : undefined;
      if (car) this.ride(player, car);
    }
    this.recordHistory();
    this.heist.onTick();
    this.sendSnapshots();
  }

  /**
   * Applies at most `maxCommandsPerTick` queued commands, in order, with the
   * same movement step the client predicts with. The cap is the speed-hack
   * guard: a client cannot move further by sending more commands than time allows.
   */
  private applyInput(player: Player): void {
    if (!player.alive) {
      // Nothing is simulated while dead, but acknowledge what arrived so the client stops replaying it.
      const newest = player.queue.at(-1);
      if (newest) player.lastAppliedSeq = newest.seq;
      player.queue.length = 0;
      return;
    }
    const budget = Math.min(this.deps.settings.maxCommandsPerTick, player.queue.length);
    const car = player.vehicleId ? this.vehicles.get(player.vehicleId) : undefined;
    for (let i = 0; i < budget; i++) {
      const command = player.queue.shift();
      if (!command) break;
      if (car) {
        // At the wheel: the stick drives the car, the body rides along, nobody shoots.
        this.vehicles.drive(car, controlsOf(command), this.collisionMap);
        this.ride(player, car);
        player.yaw = command.yaw;
        player.pitch = command.pitch;
        player.lastAppliedSeq = command.seq;
        continue;
      }
      stepBody(player.body, command, SIM_DT, this.collisionMap, this.movement, player.speedScale);
      pushBodyOutOfCars(player.body, this.movement, this.vehicles.all(), this.collisionMap);
      player.yaw = command.yaw;
      player.pitch = command.pitch;
      player.lastAppliedSeq = command.seq;
      player.cooldown = Math.max(0, player.cooldown - SIM_DT);
      // Tolerance: eight 1/60 s steps must exactly cover a 450 rpm cooldown despite float error.
      if (hasButton(command.buttons, Button.Fire) && player.cooldown <= 1e-9) {
        this.fire(player, command);
      }
    }
  }

  /**
   * Hitscan: each pellet is a ray from the shooter's aim origin. The server
   * decides everything (what is hit, damage, kills); the client only sends
   * where it was aiming.
   */
  private fire(shooter: Player, command: InputCommand): void {
    const weapon = this.combat.weapons[shooter.weaponId];
    if (!weapon) return;
    if (!shooter.infiniteAmmo) {
      const rounds = shooter.ammo;
      if (rounds <= 0) return; // click: empty
      shooter.arsenal.set(shooter.weaponId, rounds - 1);
    }
    shooter.cooldown += 60 / weapon.rpm;
    // A player cannot shoot from behind spawn protection.
    shooter.protectedUntilTick = 0;

    const origin = aimOriginInto(this.aimFrom, shooter.body, command.yaw, this.movement);
    const targets = this.targetsFor(shooter, command, weapon.range);
    // Running spoils a rifle's aim more than an SMG's; aiming down the sights tightens every gun.
    const spread = spreadFor(
      weapon,
      Math.hypot(shooter.body.vx, shooter.body.vz),
      this.movement.sprintSpeed,
      hasButton(command.buttons, Button.Aim),
    );
    const rng = this.shotRng;
    rng.reseed(this.seedNumber, this.tick, shooter.id, command.seq);

    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      // Random point in a cone: uniform over the disc, so spread is not biased to the centre.
      const radius = spread * Math.sqrt(rng.next());
      const angle = rng.next() * Math.PI * 2;
      const dir = aimDirectionInto(
        this.aimDir,
        command.yaw + (radius * Math.cos(angle)) / Math.max(0.2, Math.cos(command.pitch)),
        command.pitch + radius * Math.sin(angle),
      );
      const result = resolveShotInto(
        this.shotResult,
        this.collisionMap,
        origin,
        dir,
        weapon.range,
        targets,
        this.combat,
        this.shotTargetCount,
      );
      this.broadcastShot({
        e: 'shot',
        shooter: shooter.id,
        endX: result.end.x,
        endY: result.end.y,
        endZ: result.end.z,
        hit: result.hit,
        target: result.target,
      });
      if (result.hit === 'miss') continue;
      const victim = this.players.get(result.target);
      if (!victim) continue;
      const damage =
        damageAt(weapon, result.distance) *
        (result.hit === 'head' ? this.combat.headshotMultiplier : 1);
      this.damage(victim, damage, shooter);
    }
  }

  /**
   * Who a shot can hit, and where they were *as the shooter saw them*: rewound
   * by the lag the client reports, capped so a lying client can reach back at
   * most `maxLagCompMs`. Only completed ticks are used, so every target is
   * judged at the same moment regardless of processing order within a tick.
   */
  private targetsFor(shooter: Player, command: InputCommand, range: number): ShotTarget[] {
    const lagMs = Math.min(command.viewLagMs, this.combat.maxLagCompMs);
    const rewindTick = this.tick - (lagMs / 1000) * this.deps.settings.tickRate;
    const targets = this.shotTargets;
    // Only players near the shooter can be in range; the margin covers how far they
    // can have moved since the grid was last updated (max rewind × top speed, with room).
    const nearby = this.nearShooter;
    const found = this.interest.grid.collectNear(shooter.body.x, shooter.body.z, range + 6, nearby);
    let n = 0;
    for (let i = 0; i < found; i++) {
      const p = this.players.get(nearby[i] as number);
      if (!p || p === shooter || !p.alive || this.isProtected(p)) continue;
      let slot = targets[n];
      if (!slot) {
        slot = { id: 0, x: 0, y: 0, z: 0, height: 0 };
        targets[n] = slot;
      }
      n++;
      slot.id = p.id;
      if (this.lagComp.poseAt(p.id, rewindTick, this.rewound)) {
        slot.x = this.rewound.x;
        slot.y = this.rewound.y;
        slot.z = this.rewound.z;
        slot.height = this.rewound.height;
      } else {
        slot.x = p.body.x;
        slot.y = p.body.y;
        slot.z = p.body.z;
        slot.height = bodyHeight(p.body, this.movement);
      }
    }
    this.shotTargetCount = n;
    return targets;
  }

  private recordHistory(): void {
    for (const p of this.players.values()) {
      this.interest.update(p.id, p.body.x, p.body.z);
      if (!p.alive) continue;
      this.lagComp.record(
        this.tick,
        p.id,
        p.body.x,
        p.body.y,
        p.body.z,
        bodyHeight(p.body, this.movement),
      );
    }
  }

  /** Applies damage and handles a kill; public for tests and for rules that hurt players (none yet). */
  damage(victim: Player, amount: number, attacker: Player): void {
    if (!victim.alive || this.isProtected(victim) || this.heist.roundOver) return;
    victim.hp = Math.max(0, victim.hp - Math.round(amount));
    this.heist.onDamaged(victim);
    if (victim.hp > 0) return;
    victim.alive = false;
    this.releaseVehicle(victim);
    victim.deaths++;
    attacker.kills++;
    victim.respawnAtTick = this.tick + this.ticksFor(this.combat.respawnDelaySec);
    this.heist.onDeath(victim, attacker);
    this.broadcastQueued({ e: 'kill', killer: attacker.id, victim: victim.id });
  }

  private respawnDue(): void {
    for (const p of this.players.values()) {
      if (p.alive || this.tick < p.respawnAtTick) continue;
      const spawn =
        p.home ??
        this.spawnPolicy.pick(
          this.respawnMap,
          [...this.players.values()].filter((o) => o !== p && o.alive).map((o) => o.body),
        );
      this.lagComp.forget(p.id);
      Object.assign(p.body, createBody(spawn.x, 0, spawn.z));
      p.yaw = spawn.yaw;
      p.hp = this.combat.respawnHp;
      p.alive = true;
      p.cooldown = 0;
      this.equipStartingGear(p, p.isDummy);
      this.heist.onRespawn(p);
      // Dummies are targets: protection would only get in the way of testing.
      p.protectedUntilTick = p.isDummy
        ? 0
        : this.tick + this.ticksFor(this.combat.spawnProtectionSec);
    }
  }

  private isProtected(player: Player): boolean {
    return this.tick < player.protectedUntilTick;
  }

  private ticksFor(seconds: number): number {
    return Math.round(seconds * this.deps.settings.tickRate);
  }

  private dropIdlePlayers(): void {
    const cutoff = this.now() - this.deps.settings.idleTimeoutMs;
    for (const player of [...this.players.values()]) {
      if (!player.isDummy && player.lastHeardAt < cutoff) {
        player.connection.close(CLOSE_IDLE, 'Timed out');
        this.leave(player.id);
      }
    }
  }

  /**
   * Each client gets itself in full every tick, plus only the other players
   * its interest policy says are due (near often, far rarely, out of range never).
   * Scratch arrays and entity objects are reused across clients and ticks.
   */
  private sendSnapshots(): void {
    const ids = this.scratchIds;
    const removed = this.scratchRemoved;
    const pool = this.entityPool;
    const snapshot = this.snapshotMessage;
    const counts = this.snapshotCounts;
    const self = snapshot.self as { -readonly [K in keyof SelfState]: SelfState[K] };
    for (const player of this.players.values()) {
      if (player.isDummy) continue; // nobody is listening
      const b = player.body;
      this.interest.select(
        { id: player.id, x: b.x, z: b.z, lastSent: player.lastSent },
        this.tick,
        this.positionOf,
        ids,
        removed,
      );
      const selected = this.interest.selected;
      let listed = 0;
      for (let i = 0; i < selected; i++) {
        const other = this.players.get(ids[i] as number);
        if (!other) continue;
        let slot = pool[listed];
        if (!slot) {
          slot = { id: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, hp: 0 };
          pool[listed] = slot;
        }
        listed++;
        slot.id = other.id;
        slot.x = other.body.x;
        slot.y = other.body.y;
        slot.z = other.body.z;
        slot.yaw = other.yaw;
        slot.pitch = other.pitch;
        slot.flags = flagsOf(other, this.isProtected(other));
        slot.hp = other.hp;
      }
      counts.entities = listed;
      counts.removed = this.interest.removedCount;
      self.x = b.x;
      self.y = b.y;
      self.z = b.z;
      self.vx = b.vx;
      self.vy = b.vy;
      self.vz = b.vz;
      self.flags = flagsOf(player, this.isProtected(player));
      self.hp = player.hp;
      self.weapon = player.weaponWire;
      self.vehicle = player.vehicleId;
      this.selectVehicles(player, counts);
      self.ammo = player.infiniteAmmo
        ? (this.combat.weapons[player.weaponId]?.magSize ?? 0)
        : player.ammo;
      snapshot.tick = this.tick;
      snapshot.ackSeq = player.lastAppliedSeq;
      this.sendTo(player, snapshot, counts);
    }
  }

  /** Cars within this client's far range (and their own, always), plus the ones that left it. */
  private selectVehicles(
    player: Player,
    counts: { vehicles?: number; vehiclesRemoved?: number },
  ): void {
    const range = this.deps.settings.interest.farRange;
    const out = this.vehicleScratch;
    const inRange = this.inRange;
    inRange.clear();
    let n = 0;
    for (const car of this.vehicles.all()) {
      const near =
        car.id === player.vehicleId ||
        Math.hypot(car.state.x - player.body.x, car.state.z - player.body.z) <= range;
      if (!near) continue;
      inRange.add(car.id);
      // Reused across clients and ticks: the encoder copies what it compares.
      out[n] = car.wireInto(out[n] ?? ({} as VehicleWire));
      n++;
    }
    let removed = 0;
    for (const id of player.knownVehicles) {
      if (inRange.has(id)) continue;
      this.vehicleRemoved[removed++] = id;
      player.knownVehicles.delete(id);
    }
    for (const id of inRange) player.knownVehicles.add(id);
    counts.vehicles = n;
    counts.vehiclesRemoved = removed;
  }

  vehicleRequest(player: Player, message: VehicleMessage): VehicleReply {
    const deny = (reason: NonNullable<VehicleReply['reason']>): VehicleReply => ({
      t: 'vehicle_result',
      ref: message.ref,
      ok: false,
      reason,
    });
    if (!player.alive) return deny('dead');
    if (message.action === 'enter') {
      if (player.vehicleId !== 0) return deny('already_driving');
      const car = this.vehicles.get(message.vehicle);
      if (!car) return deny('unknown_vehicle');
      if (car.driver !== 0) return deny('taken');
      if (
        distanceToCar(car.state, car.spec, player.body.x, player.body.z) > this.vehicles.enterRange
      )
        return deny('too_far');
      car.driver = player.id;
      player.vehicleId = car.id;
      this.ride(player, car);
      return { t: 'vehicle_result', ref: message.ref, ok: true };
    }
    const car = player.vehicleId ? this.vehicles.get(player.vehicleId) : undefined;
    if (!car) return deny('not_driving');
    if (Math.abs(car.state.speed) > this.vehicles.exitMaxSpeed) return deny('too_fast');
    const spot = exitSpots(car.state, car.spec).find((p) => this.standable(p.x, p.z, car));
    if (!spot) return deny('no_room');
    car.driver = 0;
    player.vehicleId = 0;
    Object.assign(player.body, createBody(spot.x, 0, spot.z));
    this.lagComp.forget(player.id);
    return { t: 'vehicle_result', ref: message.ref, ok: true };
  }

  /** The driver's body sits in the car (shots can still find them through the window). */
  private ride(player: Player, car: Vehicle): void {
    const b = player.body;
    b.x = car.state.x;
    b.z = car.state.z;
    b.y = 0;
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    b.onGround = true;
    b.crouching = false;
  }

  /** Lets a player out of the car they drive where they are (death, leaving): the car rolls on. */
  private releaseVehicle(player: Player): void {
    const car = player.vehicleId ? this.vehicles.get(player.vehicleId) : undefined;
    if (car) car.driver = 0;
    player.vehicleId = 0;
  }

  /** Whether a standing body fits at (x, z): no wall, no building, no other car. */
  private standable(x: number, z: number, except: Vehicle): boolean {
    const r = this.movement.radius;
    const n = colliderGridFor(this.collisionMap).query(x - r, z - r, x + r, z + r, this.nearBoxes);
    for (let i = 0; i < n; i++) {
      const b = this.nearBoxes[i] as Aabb;
      const overlaps = x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ;
      if (overlaps && b.maxY > this.movement.stepHeight && b.minY < this.movement.standHeight)
        return false;
    }
    if (Math.abs(x) > this.collisionMap.halfSize || Math.abs(z) > this.collisionMap.halfSize)
      return false;
    for (const car of this.vehicles.all())
      if (car !== except && distanceToCar(car.state, car.spec, x, z) < r) return false;
    return true;
  }

  /** Sends a shot only to players close enough to see or hear it (shooter or impact within range). */
  private broadcastShot(event: Extract<GameEvent, { e: 'shot' }>): void {
    const shooter = this.players.get(event.shooter);
    const range = this.deps.settings.interest.farRange;
    this.shotEvent = event;
    this.shotBytes = encodeServerMessage({ t: 'event', event });
    this.shotRange = range;
    this.shotStamp++;
    if (shooter) this.interest.forEachNear(shooter.body.x, shooter.body.z, range, this.deliverShot);
    this.interest.forEachNear(event.endX, event.endZ, range, this.deliverShot);
  }

  /** Visitor for {@link broadcastShot}: a field, not a closure, so a shot allocates no function. */
  private readonly deliverShot = (id: number): void => {
    const p = this.players.get(id);
    const event = this.shotEvent;
    if (!p || !event || p.shotStamp === this.shotStamp) return;
    const shooter = this.players.get(event.shooter);
    const range = this.shotRange;
    const hears = (x: number, z: number) => Math.hypot(p.body.x - x, p.body.z - z) <= range;
    if (!(shooter && hears(shooter.body.x, shooter.body.z)) && !hears(event.endX, event.endZ))
      return;
    p.shotStamp = this.shotStamp;
    this.queueEvent(p, this.shotBytes);
  };

  /** Holds an encoded event until this player's next snapshot (dummies have no client to tell). */
  private queueEvent(player: Player, bytes: Uint8Array): void {
    // At most 200 per tick: a bundle holds up to 255 parts, one of which is the snapshot.
    if (player.isDummy || player.pendingCount >= 200) return;
    player.pendingEvents[player.pendingCount++] = bytes;
  }

  /** Like {@link broadcast} but delivered with each player's next snapshot instead of at once. */
  private broadcastQueued(event: GameEvent): void {
    const bytes = encodeServerMessage({ t: 'event', event });
    for (const p of this.players.values()) this.queueEvent(p, bytes);
  }

  private broadcast(event: GameEvent, exceptId?: number): void {
    const bytes = encodeServerMessage({ t: 'event', event });
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue;
      p.connection.send(bytes);
      this.traffic.bytes += bytes.length;
      this.traffic.events++;
    }
  }

  private sendTo(
    player: Player,
    message: ServerMessage,
    counts?: {
      readonly entities: number;
      readonly removed: number;
      readonly vehicles?: number;
      readonly vehiclesRemoved?: number;
    },
  ): void {
    // Snapshots go through this client's own encoder: it sends only what changed since the last one.
    let bytes = encodeServerMessage(message, player.snapshots, counts);
    if (message.t === 'snapshot') {
      this.traffic.snapshots++;
      if (player.pendingCount > 0) {
        // Shots and kills since the last snapshot ride in the same frame: one send per client per tick.
        const parts = this.bundleParts;
        parts[0] = bytes;
        for (let i = 0; i < player.pendingCount; i++)
          parts[i + 1] = player.pendingEvents[i] as Uint8Array;
        this.traffic.events += player.pendingCount;
        bytes = encodeBundle(parts, player.pendingCount + 1);
        player.pendingCount = 0;
      }
    } else {
      this.traffic.events++;
    }
    player.connection.send(bytes);
    this.traffic.bytes += bytes.length;
  }

  private allocateId(): number {
    for (let i = 0; i < MAX_ID; i++) {
      const id = this.nextId;
      this.nextId = this.nextId >= MAX_ID ? 1 : this.nextId + 1;
      if (!this.players.has(id)) return id;
    }
    throw new Error('no free player ids');
  }
}

export function flagsOf(player: Player, isProtected = false): number {
  let flags = 0;
  if (isProtected) flags |= Flag.Protected;
  if (player.body.crouching) flags |= Flag.Crouching;
  if (player.body.onGround) flags |= Flag.OnGround;
  if (player.alive) flags |= Flag.Alive;
  if (player.cash > 0) flags |= Flag.Carrying;
  return flagsWithWeapon(flags, player.weaponWire);
}

/** Printable, trimmed, never empty. Names are shown to other players, so no control characters. */
function cleanName(raw: string, id: number): string {
  const cleaned = [...raw]
    .filter((ch) => ch >= ' ' && ch !== '\u007f')
    .join('')
    .trim()
    .slice(0, 20);
  return cleaned.length > 0 ? cleaned : `Player ${id}`;
}

/** Stable 32-bit hash of a string (FNV-1a), used to seed bullet spread. */
function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
