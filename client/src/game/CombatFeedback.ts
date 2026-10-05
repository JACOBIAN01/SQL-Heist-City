import {
  Flag,
  SIM_DT,
  aimDirection,
  aimOrigin,
  hasButton,
  Button,
  raycastMap,
  type CombatSettings,
  type GameEvent,
  type GameMap,
  type InputCommand,
  type MovementSettings,
  type SelfState,
  seqNewer,
  weaponFromWire,
  type Vec3,
} from '@heist/shared';
import type { HudView } from '../ui/hud/Hud';

export interface TracerSink {
  add(from: Vec3, to: Vec3): void;
}

export interface CombatFeedbackDeps {
  readonly hud: HudView;
  readonly tracers: TracerSink;
  readonly map: GameMap;
  readonly movement: MovementSettings;
  readonly combat: CombatSettings;
  /** The local player fired a shot (to play the aim and recoil animation, and the bang). */
  readonly onLocalShot?: (weapon: string) => void;
  /** The local player pulled the trigger on an empty gun. */
  readonly onDryFire?: () => void;
  readonly myId: () => number;
  readonly myName: () => string;
  readonly nameOf: (id: number) => string;
  /** Last drawn position of another player, to start their trail from. */
  readonly positionOf: (id: number) => Vec3 | undefined;
}

/**
 * Turns server facts (snapshots, shot/kill events) and the player's own fire
 * into what you see and hear about combat. It only presents: damage, hits and
 * kills were already decided by the server.
 */
export class CombatFeedback {
  private hp: number | undefined;
  private alive = true;
  private diedAt = 0;
  private cooldown = 0;
  /** Gun in hand (from the server) and the fire commands the server has not acknowledged yet. */
  private weaponId: string | undefined;
  private ammo = 0;
  private inFlight: number[] = [];

  private map: GameMap;

  constructor(private readonly deps: CombatFeedbackDeps) {
    this.map = deps.map;
  }

  setMap(map: GameMap): void {
    this.map = map;
  }

  get isAlive(): boolean {
    return this.alive;
  }

  onSnapshot(self: SelfState, nowSeconds: number, ackSeq = 0): void {
    const { hud, combat } = this.deps;
    const alive = (self.flags & Flag.Alive) !== 0;
    if (this.hp !== undefined && self.hp < this.hp) hud.flashDamage();
    this.hp = self.hp;
    hud.setHealth(self.hp, combat.maxHp);
    this.weaponId = weaponFromWire(self.weapon);
    this.ammo = self.ammo;
    this.inFlight = this.inFlight.filter((seq) => seqNewer(seq, ackSeq));
    hud.setAmmo(self.ammo);
    hud.setProtected((self.flags & Flag.Protected) !== 0 && alive);

    if (!alive && this.alive) this.diedAt = nowSeconds;
    this.alive = alive;
    hud.setDead(!alive, combat.respawnDelaySec - (nowSeconds - this.diedAt));
  }

  /** Called for each command the player simulates: draws the player's own trail immediately. */
  onLocalCommand(
    command: InputCommand,
    body: { x: number; y: number; z: number; crouching: boolean },
  ): void {
    const weapon = this.weaponId ? this.deps.combat.weapons[this.weaponId] : undefined;
    this.cooldown = Math.max(0, this.cooldown - SIM_DT);
    if (!weapon || !this.alive) return;
    if (!hasButton(command.buttons, Button.Fire) || this.cooldown > 1e-9) return;
    // Rounds the server will have left once the shots still on their way arrive: none, no trail.
    if (this.ammo - this.inFlight.length <= 0) {
      this.deps.onDryFire?.();
      return;
    }
    this.inFlight.push(command.seq);
    this.deps.onLocalShot?.(this.weaponId ?? '');
    this.cooldown += 60 / weapon.rpm;

    const origin = aimOrigin(body, command.yaw, this.deps.movement);
    const dir = aimDirection(command.yaw, command.pitch);
    const wall = raycastMap(
      this.map,
      origin.x,
      origin.y,
      origin.z,
      dir.x,
      dir.y,
      dir.z,
      weapon.range,
    );
    const length = wall ?? weapon.range;
    // Start a little ahead of and below the eye so the trail appears to leave the gun.
    this.deps.tracers.add(
      { x: origin.x + dir.x * 0.8, y: origin.y - 0.25 + dir.y * 0.8, z: origin.z + dir.z * 0.8 },
      { x: origin.x + dir.x * length, y: origin.y + dir.y * length, z: origin.z + dir.z * length },
    );
  }

  onEvent(event: GameEvent): void {
    const { hud } = this.deps;
    const me = this.deps.myId();
    if (event.e === 'shot') {
      if (event.shooter === me) {
        if (event.hit !== 'miss') hud.showHitMarker(event.hit === 'head');
        return; // own trail was already drawn when the shot was fired
      }
      const from = this.deps.positionOf(event.shooter);
      if (from) {
        this.deps.tracers.add(
          { x: from.x, y: from.y + 1.4, z: from.z },
          { x: event.endX, y: event.endY, z: event.endZ },
        );
      }
    } else if (event.e === 'kill') {
      hud.addKill(
        this.name(event.killer),
        this.name(event.victim),
        event.killer === me || event.victim === me,
      );
    }
  }

  private name(id: number): string {
    return id === this.deps.myId() ? this.deps.myName() : this.deps.nameOf(id);
  }
}
