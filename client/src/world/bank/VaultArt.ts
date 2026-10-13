import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
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
import { mergeByMaterial } from '../../render/mergeByMaterial';
import type { BankMaterials } from './bankMaterials';
import { VAULT_TIMING, VaultDoorAnimation, type VaultEffect } from './vaultAnimation';

const BOLTS = 12;
/** Bolts reach this far into the frame when shut, and draw back this far when withdrawn. */
const BOLT_REACH = 0.1;
const BOLT_TRAVEL = 0.26;
/** How far the steel sleeve lining the doorway runs, m: the whole wall and a little past it. */
const JAMB_DEPTH = 0.5;

/** One bolt: which way it points, and where it is now (in the leaf's frame). */
export interface VaultBolt {
  readonly dir: Vector3;
  readonly angle: number;
  readonly at: Vector3;
}
const boltMatrix = new Matrix4();

/** The round door's moving parts, in a frame where the door faces +z (toward the console). */
export interface VaultDoorRig {
  readonly root: Group;
  /** Turns about y at the hinge to swing the door (positive: into the vault). */
  readonly pivot: Group;
  readonly wheel: Group;
  readonly bolts: readonly VaultBolt[];
  /** All the bolts, drawn as one instanced mesh. */
  readonly boltMesh: InstancedMesh;
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
  // Static parts are gathered here and merged into a mesh per material at the end.
  const frame = new Group();
  // The frame: a heavy square plate round the opening and a collar the door seats in.
  const plate = (w: number, h: number, x: number, y: number) => {
    const m = new Mesh(new BoxGeometry(w, h, 0.2), steel);
    m.position.set(x, y, 0.2);
    frame.add(m);
  };
  const border = 0.22;
  plate(span + 2 * border, border, 0, height + border / 2);
  plate(border, height + border, -span / 2 - border / 2, (height + border) / 2);
  plate(border, height + border, span / 2 + border / 2, (height + border) / 2);
  // The jamb: a steel sleeve lining the opening right through the wall, with a threshold, so the
  // door sits in a deep frame instead of a flat hole.
  const sleeve = (w: number, h: number, x: number, y: number) => {
    const m = new Mesh(new BoxGeometry(w, h, JAMB_DEPTH), steel);
    m.position.set(x, y, 0);
    frame.add(m);
  };
  sleeve(span, 0.08, 0, height - 0.04);
  sleeve(0.06, height, -span / 2 + 0.03, cy);
  sleeve(0.06, height, span / 2 - 0.03, cy);
  sleeve(span, 0.05, 0, 0.025);
  // Rivets along the plate, and a brass ring where the door seats.
  const studs: Matrix4[] = [];
  for (let u = -span / 2 - border / 2; u <= span / 2 + border / 2 + 1e-6; u += 0.3)
    studs.push(new Matrix4().makeTranslation(u, height + border / 2, 0.31));
  for (const side of [-1, 1])
    for (let y = 0.2; y < height; y += 0.3)
      studs.push(new Matrix4().makeTranslation(side * (span / 2 + border / 2), y, 0.31));
  const rivets = new InstancedMesh(new SphereGeometry(0.035, 8, 6), brass, studs.length);
  studs.forEach((m, i) => rivets.setMatrixAt(i, m));
  frame.add(rivets);
  const seat = new Mesh(new TorusGeometry(radius + 0.09, 0.025, 8, 48), brass);
  seat.position.set(0, cy, 0.27);
  frame.add(seat);
  const collar = new Mesh(new TorusGeometry(radius + 0.05, 0.07, 10, 48), steel);
  collar.position.set(0, cy, 0.2);
  frame.add(collar);

  // The hinge side, and the door turning on it.
  const pivot = new Group();
  pivot.position.set(-radius, cy, 0);
  root.add(pivot);
  const leaf = new Group(); // the door's fixed-to-the-leaf parts, merged below
  for (const dy of [-radius * 0.55, radius * 0.55]) {
    const knuckle = new Mesh(new CylinderGeometry(0.07, 0.07, 0.4, 12), steel);
    knuckle.position.set(-0.06, dy, 0.22);
    leaf.add(knuckle);
  }
  const disc = new Mesh(new CylinderGeometry(radius, radius, 0.35, 48), steel);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(radius, 0, 0);
  leaf.add(disc);
  const ring = new Mesh(new TorusGeometry(radius * 0.72, 0.03, 8, 40), brass);
  ring.position.set(radius, 0, 0.18);
  leaf.add(ring);

  const wheel = new Group();
  wheel.position.set(radius, 0, 0.3);
  const wheelParts = new Group(); // unparented: merged into the wheel below
  wheelParts.add(new Mesh(new TorusGeometry(0.36, 0.035, 8, 32), brass));
  for (let i = 0; i < 3; i++) {
    const spoke = new Mesh(new BoxGeometry(0.72, 0.045, 0.045), brass);
    spoke.rotation.z = (i * Math.PI) / 3;
    wheelParts.add(spoke);
  }
  const hub = new Mesh(new CylinderGeometry(0.09, 0.09, 0.12, 16), brass);
  hub.rotation.x = Math.PI / 2;
  wheelParts.add(hub);
  wheel.add(...mergeByMaterial(wheelParts, 'wheel').children);
  pivot.add(wheel);

  // The twelve bolts are one instanced mesh (one draw call); poseVaultDoor moves each instance.
  const bolts: VaultBolt[] = [];
  const boltMesh = new InstancedMesh(new CylinderGeometry(0.045, 0.045, 0.3, 10), brass, BOLTS);
  for (let i = 0; i < BOLTS; i++) {
    const a = (i / BOLTS) * Math.PI * 2;
    bolts.push({
      dir: new Vector3(Math.cos(a), Math.sin(a), 0),
      angle: a - Math.PI / 2,
      at: new Vector3(),
    });
  }
  boltMesh.frustumCulled = false; // the instances move; the base sphere would not follow
  pivot.add(boltMesh);

  root.add(...mergeByMaterial(frame, 'frame').children);
  pivot.add(...mergeByMaterial(leaf, 'leaf').children);
  root.updateMatrixWorld(true);
  const rim = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return new Vector3(Math.cos(a) * radius, cy + Math.sin(a) * radius, 0.25).applyMatrix4(
      root.matrixWorld,
    );
  });
  const rig: VaultDoorRig = { root, pivot, wheel, bolts, boltMesh, radius, rim };
  poseVaultDoor(rig, { wheel: 0, bolts: Array<number>(BOLTS).fill(0), swing: 0 });
  return rig;
}

/** Puts the door's parts where a pose says. */
export function poseVaultDoor(
  rig: VaultDoorRig,
  pose: { wheel: number; bolts: readonly number[]; swing: number },
): void {
  rig.wheel.rotation.z = pose.wheel;
  rig.bolts.forEach((b, i) => {
    const d = rig.radius + BOLT_REACH - 0.15 - BOLT_TRAVEL * (pose.bolts[i] ?? 0);
    b.at.set(rig.radius + b.dir.x * d, b.dir.y * d, 0);
    boltMatrix.makeRotationZ(b.angle).setPosition(b.at);
    rig.boltMesh.setMatrixAt(i, boltMatrix);
  });
  rig.boltMesh.instanceMatrix.needsUpdate = true;
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
      // A steel block with a plane of small doors on the face toward the room: two materials, and
      // (merged across runs) two draw calls however many walls of boxes there are.
      const alongX = run.facing === '+z' || run.facing === '-z';
      const along = alongX ? w : d;
      const body = new Mesh(new BoxGeometry(w, FITTING_HEIGHT, d), materials.steel);
      body.position.set(cx, floorY + FITTING_HEIGHT / 2, cz);
      group.add(body);
      const doors = new PlaneGeometry(along, FITTING_HEIGHT);
      // Repeat the door texture once per metre.
      const uv = doors.getAttribute('uv') as BufferAttribute;
      for (let v = 0; v < uv.count; v++)
        uv.setXY(v, uv.getX(v) * along, uv.getY(v) * FITTING_HEIGHT);
      const face = new Mesh(doors, materials.deposit);
      const n = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] }[run.facing];
      face.position.set(
        cx + (n[0] ?? 0) * (w / 2 + 0.003),
        floorY + FITTING_HEIGHT / 2,
        cz + (n[1] ?? 0) * (d / 2 + 0.003),
      );
      face.rotation.y = Math.atan2(n[0] ?? 0, n[1] ?? 0);
      group.add(face);
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
    // Bundles come in three kinds (one band, two bands, loose notes), each a little different in
    // size, tint and angle, so a full shelf never shows the same band over and over.
    const kinds = [materials.cash, materials.cashTwin, materials.cashLoose];
    const matrices: Matrix4[][] = kinds.map(() => []);
    const tints: Color[][] = kinds.map(() => []);
    const m = new Matrix4();
    const q = new Quaternion();
    const hash = (a: number) => {
      const t = Math.sin(a * 12.9898 + 78.233) * 43758.5453;
      return t - Math.floor(t);
    };
    for (const y of [0.04, 0.57, 1.12, 1.67])
      for (let i = 0; i < perShelf; i++)
        for (let k = 0; k < 3; k++) {
          const seed = i * 31 + k * 17 + Math.round(y * 100);
          const u = -length / 2 + 0.1 + i * 0.2;
          const v = -depth / 2 + 0.06 + k * 0.1;
          const high = 1 + ((i * 7 + k * 3 + Math.round(y * 10)) % 4);
          for (let j = 0; j < high; j++) {
            const r = hash(seed + j * 7.7);
            const kind = Math.floor(hash(seed * 3 + j) * kinds.length);
            const lift = y + 0.05 + j * 0.1;
            const jitter = (r - 0.5) * 0.02;
            const yaw = (hash(seed + j * 3.1) - 0.5) * 0.16 + (alongX ? 0 : Math.PI / 2);
            m.compose(
              alongX ? new Vector3(u + jitter, lift, v) : new Vector3(v, lift, u + jitter),
              q.setFromAxisAngle(new Vector3(0, 1, 0), yaw),
              new Vector3(0.9 + hash(seed + j) * 0.2, 1, 1),
            );
            (matrices[kind] as Matrix4[]).push(m.clone());
            const f = 0.82 + r * 0.3;
            (tints[kind] as Color[]).push(new Color(f, f * (0.96 + r * 0.08), f * 0.95));
          }
        }
    kinds.forEach((material, kind) => {
      const list = matrices[kind] as Matrix4[];
      if (!list.length) return;
      const mesh = new InstancedMesh(new BoxGeometry(0.16, 0.1, 0.07), material, list.length);
      list.forEach((mx, idx) => {
        mesh.setMatrixAt(idx, mx);
        mesh.setColorAt(idx, (tints[kind] as Color[])[idx] as Color);
      });
      frame.add(mesh);
    });
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
  /** Holds all of this vault's art. */
  readonly holder: Group;
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
      const layout = layouts.get(v.tier);
      // Everything of one vault in one group, tagged with its bank and storey so BankLod can
      // leave it out while nobody is near enough to see it.
      const holder = new Group();
      holder.name = `vault-art-${v.id}`;
      holder.userData = {
        bankTier: v.tier,
        fine: true,
        storey: Math.round(door.minY / (layout?.storeyHeight ?? 3)),
      };
      this.root.add(holder);
      holder.add(rig.root);
      const spec = layout?.vaults?.find((s) => v.id.endsWith(`:${s.id}`));
      const site = map.banks?.find((b) => b.tier === v.tier);
      if (spec && site) {
        const floorY = spec.storey * (layout?.storeyHeight ?? 3);
        holder.add(
          mergeByMaterial(
            buildFittings(spec.fittings?.depositBoxes ?? [], 'deposit', site, floorY, materials),
            'deposit-boxes',
          ),
          mergeByMaterial(
            buildFittings(spec.fittings?.cashShelves ?? [], 'cash', site, floorY, materials),
            'cash-shelves',
          ),
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
      holder.add(dome);
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
      holder.add(spinner);
      const particles = new Particles();
      holder.add(particles.points);
      this.vaults.push({
        id: v.id,
        holder,
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
        if (v.keypad) v.holder.remove(v.keypad.group);
        v.keypad = buildKeypad(v.keypadAt, v.facing, view.locks, this.materials);
        v.holder.add(v.keypad.group);
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
