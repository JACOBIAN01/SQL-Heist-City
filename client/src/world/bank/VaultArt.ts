import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three';
import {
  BANK_LAYOUTS,
  FITTING_HEIGHT,
  findAnchor,
  wallRunRect,
  type BankLayout,
  type GameMap,
  type MapBox,
  type VaultView,
  type WallRun,
} from '@heist/shared';
import type { BankMaterials } from './bankMaterials';
import { VAULT_TIMING, VaultDoorAnimation, type VaultEffect } from './vaultAnimation';

const BOLTS = 12;
/** Bolts reach this far into the frame when shut, and draw back this far when withdrawn. */
const BOLT_REACH = 0.1;
const BOLT_TRAVEL = 0.26;

/** The round door's moving parts, in a frame where the door faces +z (toward the console). */
export interface VaultDoorRig {
  readonly root: Group;
  /** Turns about y at the hinge to swing the door (positive: into the vault). */
  readonly pivot: Group;
  readonly wheel: Group;
  readonly bolts: readonly { readonly mesh: Mesh; readonly dir: Vector3 }[];
  readonly radius: number;
  /** Where sparks fly from: points round the rim, world coordinates. */
  readonly rim: readonly Vector3[];
}

/**
 * Builds the round vault door for a door collider: a steel disc in a collar,
 * hinged at one side, twelve bolts into the frame, and a spoked brass wheel
 * on the face toward the console.
 */
export function buildVaultDoor(
  door: MapBox,
  consoleAt: { readonly x: number; readonly z: number },
  materials: BankMaterials,
): VaultDoorRig {
  const cx = (door.minX + door.maxX) / 2;
  const cz = (door.minZ + door.maxZ) / 2;
  const sx = door.maxX - door.minX;
  const sz = door.maxZ - door.minZ;
  const height = door.maxY - door.minY;
  // The door is thin along its normal; the normal points to the console's side.
  const normalAlongX = sx < sz;
  const toward = normalAlongX ? Math.sign(consoleAt.x - cx) || 1 : Math.sign(consoleAt.z - cz) || 1;
  const nx = normalAlongX ? toward : 0;
  const nz = normalAlongX ? 0 : toward;
  const span = Math.max(sx, sz);
  const radius = Math.min(span, height) / 2 - 0.04;
  const cy = height / 2;

  const root = new Group();
  root.name = 'vault-door';
  root.position.set(cx, door.minY, cz);
  root.rotation.y = Math.atan2(nx, nz);

  const steel = materials.steel;
  const brass = materials.brass;
  // The frame: a heavy square plate round the opening and a collar the door seats in.
  const plate = (w: number, h: number, x: number, y: number) => {
    const m = new Mesh(new BoxGeometry(w, h, 0.12), steel);
    m.position.set(x, y, 0.16);
    root.add(m);
  };
  const border = 0.22;
  plate(span + 2 * border, border, 0, height + border / 2);
  plate(border, height + border, -span / 2 - border / 2, (height + border) / 2);
  plate(border, height + border, span / 2 + border / 2, (height + border) / 2);
  const collar = new Mesh(new TorusGeometry(radius + 0.05, 0.07, 10, 48), steel);
  collar.position.set(0, cy, 0.2);
  root.add(collar);

  // The hinge side, and the door turning on it.
  const pivot = new Group();
  pivot.position.set(-radius, cy, 0);
  root.add(pivot);
  for (const dy of [-radius * 0.55, radius * 0.55]) {
    const knuckle = new Mesh(new CylinderGeometry(0.07, 0.07, 0.4, 12), steel);
    knuckle.position.set(-0.06, dy, 0.22);
    pivot.add(knuckle);
  }
  const disc = new Mesh(new CylinderGeometry(radius, radius, 0.35, 48), steel);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(radius, 0, 0);
  pivot.add(disc);
  const ring = new Mesh(new TorusGeometry(radius * 0.72, 0.03, 8, 40), brass);
  ring.position.set(radius, 0, 0.18);
  pivot.add(ring);

  const wheel = new Group();
  wheel.position.set(radius, 0, 0.3);
  wheel.add(new Mesh(new TorusGeometry(0.36, 0.035, 8, 32), brass));
  for (let i = 0; i < 3; i++) {
    const spoke = new Mesh(new BoxGeometry(0.72, 0.045, 0.045), brass);
    spoke.rotation.z = (i * Math.PI) / 3;
    wheel.add(spoke);
  }
  const hub = new Mesh(new CylinderGeometry(0.09, 0.09, 0.12, 16), brass);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  pivot.add(wheel);

  const bolts: { mesh: Mesh; dir: Vector3 }[] = [];
  const boltGeo = new CylinderGeometry(0.045, 0.045, 0.3, 10);
  for (let i = 0; i < BOLTS; i++) {
    const a = (i / BOLTS) * Math.PI * 2;
    const dir = new Vector3(Math.cos(a), Math.sin(a), 0);
    const mesh = new Mesh(boltGeo, brass);
    mesh.rotation.z = a - Math.PI / 2;
    mesh.position.set(
      radius + dir.x * (radius + BOLT_REACH - 0.15),
      dir.y * (radius + BOLT_REACH - 0.15),
      0,
    );
    pivot.add(mesh);
    bolts.push({ mesh, dir });
  }

  root.updateMatrixWorld(true);
  const rim = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return new Vector3(Math.cos(a) * radius, cy + Math.sin(a) * radius, 0.25).applyMatrix4(
      root.matrixWorld,
    );
  });
  return { root, pivot, wheel, bolts, radius, rim };
}

/** Puts the door's parts where a pose says. */
export function poseVaultDoor(
  rig: VaultDoorRig,
  pose: { wheel: number; bolts: readonly number[]; swing: number },
): void {
  rig.wheel.rotation.z = pose.wheel;
  rig.bolts.forEach((b, i) => {
    const d = rig.radius + BOLT_REACH - 0.15 - BOLT_TRAVEL * (pose.bolts[i] ?? 0);
    b.mesh.position.set(rig.radius + b.dir.x * d, b.dir.y * d, 0);
  });
  rig.pivot.rotation.y = pose.swing * VAULT_TIMING.swingAngle;
}

/** A run of deposit boxes or cash shelves against a vault wall. */
function buildFittings(
  runs: readonly WallRun[],
  kind: 'deposit' | 'cash',
  at: { x: number; z: number },
  floorY: number,
  materials: BankMaterials,
): Group {
  const group = new Group();
  for (const run of runs) {
    const r = wallRunRect(run, at);
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    if (kind === 'deposit') {
      // BoxGeometry faces: +x, −x, +y, −y, +z, −z. The face toward the room shows the doors.
      const front = { '+x': 0, '-x': 1, '+z': 4, '-z': 5 }[run.facing];
      const mats: Material[] = Array.from({ length: 6 }, (_, i) =>
        i === front ? materials.deposit : materials.steel,
      );
      const geo = new BoxGeometry(w, FITTING_HEIGHT, d);
      // Repeat the door texture once per metre on the front face.
      const uv = geo.getAttribute('uv') as BufferAttribute;
      const along = run.facing === '+z' || run.facing === '-z' ? w : d;
      for (let v = front * 4; v < front * 4 + 4; v++)
        uv.setXY(v, uv.getX(v) * along, uv.getY(v) * FITTING_HEIGHT);
      const body = new Mesh(geo, mats);
      body.position.set(cx, floorY + FITTING_HEIGHT / 2, cz);
      group.add(body);
      continue;
    }
    // Cash shelves: a steel frame, four shelves, and bundles of notes stacked on each.
    const frame = new Group();
    frame.position.set(cx, floorY, cz);
    for (const y of [0.02, 0.55, 1.1, 1.65, 2.18]) {
      const shelf = new Mesh(new BoxGeometry(w, 0.04, d), materials.steel);
      shelf.position.y = y;
      frame.add(shelf);
    }
    const alongX = run.facing === '+z' || run.facing === '-z';
    const length = alongX ? w : d;
    const depth = alongX ? d : w;
    const perShelf = Math.floor(length / 0.2);
    // Up to four bundles in each stack (0.1 m each), so the shelves look full but uneven.
    const bundles = new InstancedMesh(
      new BoxGeometry(0.16, 0.1, 0.07),
      materials.cash,
      perShelf * 3 * 4 * 4,
    );
    const m = new Matrix4();
    let n = 0;
    for (const y of [0.04, 0.57, 1.12, 1.67])
      for (let i = 0; i < perShelf; i++)
        for (let k = 0; k < 3; k++) {
          const u = -length / 2 + 0.1 + i * 0.2;
          const v = -depth / 2 + 0.06 + k * 0.1;
          const high = 1 + ((i * 7 + k * 3 + Math.round(y * 10)) % 4);
          for (let j = 0; j < high; j++) {
            const lift = y + 0.05 + j * 0.1;
            if (alongX) m.makeTranslation(u, lift, v);
            else m.makeRotationY(Math.PI / 2).setPosition(v, lift, u);
            bundles.setMatrixAt(n++, m);
          }
        }
    bundles.count = n;
    frame.add(bundles);
    group.add(frame);
  }
  return group;
}

/** The console the locks are worked at: a pedestal with a screen and one light per lock. */
interface Keypad {
  readonly group: Group;
  readonly screen: MeshStandardMaterial;
  readonly leds: readonly MeshStandardMaterial[];
}

const LOCKED = 0xd22a2a;
const OPEN = 0x2ad25a;
const CRACKING = 0xffb020;

/** A keypad on the wall beside the door: a screen and one light per lock, facing the console side. */
function buildKeypad(
  at: { x: number; y: number; z: number },
  facing: Vector3,
  locks: number,
  materials: BankMaterials,
): Keypad {
  const group = new Group();
  group.position.set(at.x, at.y, at.z);
  group.rotation.y = Math.atan2(facing.x, facing.z);
  const box = new Mesh(new BoxGeometry(0.34, 0.5, 0.08), materials.steel);
  group.add(box);
  const screen = new MeshStandardMaterial({
    color: 0x111111,
    emissive: LOCKED,
    emissiveIntensity: 1.2,
  });
  const panel = new Mesh(new BoxGeometry(0.26, 0.16, 0.01), screen);
  panel.position.set(0, 0.1, 0.045);
  group.add(panel);
  const leds = Array.from({ length: Math.max(1, locks) }, (_, i) => {
    const mat = new MeshStandardMaterial({
      color: 0x222222,
      emissive: 0x000000,
      emissiveIntensity: 1.5,
    });
    const led = new Mesh(new SphereGeometry(0.022, 8, 6), mat);
    led.position.set(-0.11 + (0.22 * (i + 0.5)) / Math.max(1, locks), -0.1, 0.045);
    group.add(led);
    return mat;
  });
  return { group, screen, leds };
}

/** Sparks and dust: a small pool of glowing points that fly and fall. */
class Particles {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly tint: Float32Array;
  private next = 0;

  constructor(private readonly count = 160) {
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.tint = new Float32Array(count * 3);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('color', new BufferAttribute(this.col, 3));
    this.points = new Points(
      g,
      new PointsMaterial({
        size: 0.07,
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
  }

  burst(kind: VaultEffect['kind'], from: readonly Vector3[], n: number): void {
    for (let i = 0; i < n; i++) {
      const p = from[Math.floor(Math.random() * from.length)];
      if (!p) return;
      const k = this.next;
      this.next = (this.next + 1) % this.count;
      this.pos.set([p.x, p.y, p.z], k * 3);
      const spark = kind === 'sparks';
      const speed = spark ? 2 + Math.random() * 3 : 0.4 + Math.random() * 0.6;
      this.vel.set(
        [
          (Math.random() - 0.5) * speed,
          (spark ? 1 : 0.3) * Math.random() * speed,
          (Math.random() - 0.5) * speed,
        ],
        k * 3,
      );
      this.life[k] = spark ? 0.5 + Math.random() * 0.4 : 1 + Math.random() * 0.6;
      this.tint.set(spark ? [1, 0.6 + Math.random() * 0.3, 0.2] : [0.35, 0.33, 0.3], k * 3);
    }
  }

  update(dt: number): void {
    let any = false;
    for (let k = 0; k < this.count; k++) {
      const life = this.life[k] ?? 0;
      if (life <= 0) {
        this.col.set([0, 0, 0], k * 3);
        continue;
      }
      any = true;
      this.life[k] = life - dt;
      const i = k * 3;
      this.vel[i + 1] = (this.vel[i + 1] ?? 0) - 9.8 * dt * (this.tint[i] === 1 ? 1 : 0.1);
      for (let a = 0; a < 3; a++)
        this.pos[i + a] = (this.pos[i + a] ?? 0) + (this.vel[i + a] ?? 0) * dt;
      const fade = Math.min(1, life * 2);
      for (let a = 0; a < 3; a++) this.col[i + a] = (this.tint[i + a] ?? 0) * fade;
    }
    this.points.visible = any;
    const g = this.points.geometry;
    const position = g.getAttribute('position');
    const color = g.getAttribute('color');
    if (position) position.needsUpdate = true;
    if (color) color.needsUpdate = true;
  }
}

interface VaultPieces {
  readonly id: string;
  readonly rig: VaultDoorRig;
  /** Made when the server first says how many locks the vault has. */
  animation: VaultDoorAnimation | undefined;
  keypad: Keypad | undefined;
  /** Where the keypad hangs and which way it faces. */
  readonly keypadAt: { x: number; y: number; z: number };
  readonly facing: Vector3;
  readonly beacon: MeshStandardMaterial;
  readonly beam: Mesh;
  readonly particles: Particles;
  pending: VaultEffect[];
  crackFlashUntil: number;
  open: boolean;
}

/**
 * Every vault on the map as it looks and moves: the round door, the keypad,
 * the alarm beacon over the door, deposit boxes and cash shelves inside.
 * Cracking a lock turns the wheel, draws that lock's bolts and throws sparks;
 * the last lock spins the wheel, draws every bolt and swings the door open in
 * a puff of dust. Art only: the server has opened the door the moment the
 * lock fell.
 */
export class VaultArt {
  readonly root = new Group();
  private readonly vaults: VaultPieces[] = [];

  constructor(
    map: GameMap,
    private readonly materials: BankMaterials,
    layouts: ReadonlyMap<number, BankLayout> = BANK_LAYOUTS,
  ) {
    this.root.name = 'vaults';
    for (const v of map.vaults ?? []) {
      const door = map.doors?.find((d) => d.id === v.doorId)?.box;
      const console_ = findAnchor(map, v.consoleId);
      if (!door || !console_) continue;
      const rig = buildVaultDoor(door, console_, materials);
      this.root.add(rig.root);
      const layout = layouts.get(v.tier);
      const spec = layout?.vaults?.find((s) => v.id.endsWith(`:${s.id}`));
      const site = map.banks?.find((b) => b.tier === v.tier);
      if (spec && site) {
        const floorY = spec.storey * (layout?.storeyHeight ?? 3);
        this.root.add(
          buildFittings(spec.fittings?.depositBoxes ?? [], 'deposit', site, floorY, materials),
        );
        this.root.add(
          buildFittings(spec.fittings?.cashShelves ?? [], 'cash', site, floorY, materials),
        );
      }
      // The keypad hangs on the wall beside the door, on the console side.
      const doorX = (door.minX + door.maxX) / 2;
      const doorZ = (door.minZ + door.maxZ) / 2;
      const normalAlongX = door.maxX - door.minX < door.maxZ - door.minZ;
      const facing = normalAlongX
        ? new Vector3(Math.sign(console_.x - doorX) || 1, 0, 0)
        : new Vector3(0, 0, Math.sign(console_.z - doorZ) || 1);
      const along = normalAlongX ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
      const halfSpan = Math.max(door.maxX - door.minX, door.maxZ - door.minZ) / 2;
      const keypadAt = {
        x: doorX + along.x * (halfSpan + 0.55) + facing.x * 0.15,
        y: door.minY + 1.3,
        z: doorZ + along.z * (halfSpan + 0.55) + facing.z * 0.15,
      };
      // The alarm: a red dome over the door on the console side, and a turning beam.
      const beacon = new MeshStandardMaterial({
        color: 0x550000,
        emissive: 0xff2020,
        emissiveIntensity: 0,
      });
      const dome = new Mesh(
        new SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        beacon,
      );
      dome.position.set(doorX + facing.x * 0.3, door.maxY + 0.3, doorZ + facing.z * 0.3);
      this.root.add(dome);
      const beam = new Mesh(
        new ConeGeometry(0.35, 1.2, 16, 1, true),
        new MeshBasicMaterial({
          color: 0xff2020,
          transparent: true,
          opacity: 0.18,
          blending: AdditiveBlending,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
      beam.position.copy(dome.position);
      beam.rotation.z = Math.PI / 2;
      beam.visible = false;
      const spinner = new Group();
      spinner.position.copy(dome.position);
      beam.position.set(0.6, 0, 0);
      spinner.add(beam);
      this.root.add(spinner);
      const particles = new Particles();
      this.root.add(particles.points);
      this.vaults.push({
        id: v.id,
        rig,
        animation: undefined,
        keypad: undefined,
        keypadAt,
        facing,
        beacon,
        beam,
        particles,
        pending: [],
        crackFlashUntil: -Infinity,
        open: false,
      });
    }
  }

  /** The server's vault progress (on join and every time a lock opens). */
  onVaults(views: readonly VaultView[], now: number): void {
    for (const view of views) {
      const v = this.find(view.id);
      if (!v) continue;
      if (!v.animation || v.animation.locks !== view.locks) {
        // The lock count is a setting: the door's story and the keypad's lights follow it.
        v.animation = new VaultDoorAnimation(view.locks, BOLTS);
        if (v.keypad) this.root.remove(v.keypad.group);
        v.keypad = buildKeypad(v.keypadAt, v.facing, view.locks, this.materials);
        this.root.add(v.keypad.group);
      }
      const effects = v.animation.observe(view.opened, now);
      if (effects.length > 0) v.crackFlashUntil = now + 0.6;
      v.pending.push(...effects);
      this.paintKeypad(v, view.opened, view.locks);
    }
  }

  /** Every frame: move the doors, run the particles, flash the alarms. */
  update(now: number, dt: number, alarm: (vaultId: string) => boolean): void {
    for (const v of this.vaults) {
      if (v.animation) poseVaultDoor(v.rig, v.animation.pose(now));
      for (const e of v.pending.filter((p) => p.at <= now))
        v.particles.burst(e.kind, v.rig.rim, e.kind === 'sparks' ? 50 : 70);
      v.pending = v.pending.filter((p) => p.at > now);
      v.particles.update(dt);
      const ringing = alarm(v.id);
      const pulse = 0.5 + 0.5 * Math.sin(now * 10);
      v.beacon.emissiveIntensity = ringing ? 0.5 + 2.5 * pulse : 0;
      v.beam.visible = ringing;
      if (v.beam.parent) v.beam.parent.rotation.y = now * 6;
      if (v.keypad && now < v.crackFlashUntil) v.keypad.screen.emissive.setHex(CRACKING);
      else if (v.keypad && v.animation) v.keypad.screen.emissive.setHex(v.open ? OPEN : LOCKED);
    }
  }

  private paintKeypad(v: VaultPieces, opened: number, locks: number): void {
    v.open = opened >= locks;
    v.keypad?.leds.forEach((led, i) => led.emissive.setHex(i < opened ? OPEN : 0x000000));
  }

  private find(id: string): VaultPieces | undefined {
    return this.vaults.find((v) => v.id === id);
  }
}
