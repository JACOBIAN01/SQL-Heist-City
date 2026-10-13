import type { BufferGeometry } from 'three';
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BANK_LAYOUTS,
  FURNITURE_PIECES,
  compileBankParts,
  isFurniturePiece,
  placeFurniture,
  stairFootprint,
  type Aabb,
  type BankLayout,
  type GameMap,
  type PlacedBank,
} from '@heist/shared';
import { ceilingLightSpots } from './BankFurnitureArt';

/**
 * The finishing touches that stop a bank looking like a stage set (11.9b):
 * desk tops with monitors and keyboards over the cabinets, framed windows and
 * pictures along the outside walls, soft pools of light under every lamp and
 * soft shadows under furniture. All art, built from the layout: nothing
 * collides, and everything is merged into a handful of meshes per bank.
 * Pattern: Builder — Why: one pass over a layout turns its data into the
 * decoration, so a new bank is dressed by describing it, not by hand.
 */

export interface BankDecor {
  readonly root: Group;
  /** 0 by day … 1 at night: the windows go dark. */
  setNight(night: number): void;
}

const WINDOW_W = 1.2;
const WINDOW_H = 1.3;
const WINDOW_SILL = 0.85;
const PICTURE_W = 0.96;
const PICTURE_H = 0.66;
const PICTURE_Y = 1.6;
/** Windows and pictures alternate along a wall at this pitch, m. */
const WALL_PITCH = 2;
/** How far from the wall an obstacle still stops a window, m. */
const WALL_REACH = 0.7;
/** A lamp's pool of light and a lamp-shaped pool under a chandelier, m across. */
const POOL = 2.8;
const POOL_CHANDELIER = 4.4;
const WINDOW_BAND = { from: WINDOW_SILL, to: WINDOW_SILL + WINDOW_H };

const DESK_TOP = 0.05;
/** Pictures in the atlas: a landscape, a seascape and an abstract, side by side. */
const PAINTINGS = 3;
const NO_BLOB = /^(Door_|Window_|Curtains_|Carpet_|Light_)/;

/** Geometry gathered per material, merged into one mesh at the end. */
class Batch {
  private readonly parts: BufferGeometry[] = [];
  /** `color` paints the part in vertex colours; `tile` picks one of the picture atlas's tiles. */
  add(geo: BufferGeometry, matrix: Matrix4, options: { color?: number; tile?: number } = {}): void {
    const g = geo.clone();
    g.applyMatrix4(matrix);
    if (options.color !== undefined) {
      const c = new Color(options.color);
      const n = g.getAttribute('position').count;
      g.setAttribute(
        'color',
        new BufferAttribute(
          Float32Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3] ?? 0),
          3,
        ),
      );
    }
    if (options.tile !== undefined) {
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) + (options.tile ?? 0)) / PAINTINGS);
    }
    this.parts.push(g);
  }
  mesh(material: Material, name: string): Mesh | undefined {
    if (this.parts.length === 0) return undefined;
    const geometry = mergeGeometries(this.parts);
    if (!geometry) return undefined;
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    return mesh;
  }
  get size(): number {
    return this.parts.length;
  }
}

const canvasOf = (w: number, h: number) => {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : undefined;
};

function textured(canvas: ReturnType<typeof canvasOf>): CanvasTexture | undefined {
  if (!canvas) return undefined;
  const t = new CanvasTexture(canvas.c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function radialTexture(rgb: string): CanvasTexture | undefined {
  const cv = canvasOf(64, 64);
  if (!cv) return undefined;
  const grad = cv.g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${rgb},1)`);
  grad.addColorStop(0.5, `rgba(${rgb},0.4)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  cv.g.fillStyle = grad;
  cv.g.fillRect(0, 0, 64, 64);
  return textured(cv);
}

function skyTexture(): CanvasTexture | undefined {
  const cv = canvasOf(64, 128);
  if (!cv) return undefined;
  const grad = cv.g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#6fa8dc');
  grad.addColorStop(1, '#dcebf7');
  cv.g.fillStyle = grad;
  cv.g.fillRect(0, 0, 64, 128);
  cv.g.fillStyle = 'rgba(255,255,255,0.85)';
  for (const [x, y, r] of [
    [18, 40, 12],
    [34, 46, 15],
    [46, 36, 10],
    [24, 90, 9],
    [40, 96, 12],
  ] as const) {
    cv.g.beginPath();
    cv.g.ellipse(x, y, r * 1.4, r * 0.7, 0, 0, Math.PI * 2);
    cv.g.fill();
  }
  return textured(cv);
}

/** Three pictures painted in code, as drawing routines for a 112 × 76 tile. */
function paintings(): ((g: CanvasRenderingContext2D) => void)[] {
  const paint = (draw: (g: CanvasRenderingContext2D) => void) => draw;
  return [
    paint((g) => {
      g.fillStyle = '#9cc7e8';
      g.fillRect(0, 0, 112, 40);
      g.fillStyle = '#5f8f4e';
      g.fillRect(0, 40, 112, 36);
      g.fillStyle = '#7da86a';
      g.beginPath();
      g.ellipse(30, 44, 50, 14, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffe9a0';
      g.beginPath();
      g.arc(86, 16, 8, 0, Math.PI * 2);
      g.fill();
    }),
    paint((g) => {
      g.fillStyle = '#d9a35c';
      g.fillRect(0, 0, 112, 30);
      g.fillStyle = '#2f6f9f';
      g.fillRect(0, 30, 112, 46);
      g.strokeStyle = '#a9d3ee';
      g.lineWidth = 2;
      for (let y = 38; y < 76; y += 9) {
        g.beginPath();
        g.moveTo(0, y);
        g.quadraticCurveTo(28, y - 5, 56, y);
        g.quadraticCurveTo(84, y + 5, 112, y);
        g.stroke();
      }
    }),
    paint((g) => {
      g.fillStyle = '#efe6d2';
      g.fillRect(0, 0, 112, 76);
      for (const [c, x, y, w, h] of [
        ['#b23a30', 10, 12, 40, 30],
        ['#2d4a7a', 54, 8, 46, 22],
        ['#d3a437', 36, 44, 56, 22],
      ] as const) {
        g.fillStyle = c;
        g.fillRect(x, y, w, h);
      }
    }),
  ];
}

/** The three pictures on one canvas, so a storey's pictures are one mesh and one draw call. */
function pictureAtlas(): CanvasTexture | undefined {
  const cv = canvasOf(112 * PAINTINGS, 76);
  if (!cv) return undefined;
  paintings().forEach((draw, i) => {
    cv.g.save();
    cv.g.translate(i * 112, 0);
    draw(cv.g);
    cv.g.restore();
  });
  return textured(cv);
}

const overlaps = (a: Aabb, b: Aabb) =>
  a.minX < b.maxX &&
  a.maxX > b.minX &&
  a.minY < b.maxY &&
  a.maxY > b.minY &&
  a.minZ < b.maxZ &&
  a.maxZ > b.minZ;

/** Everything on a storey that a window or a pool of light must keep clear of. */
function obstacles(layout: BankLayout, site: PlacedBank): Aabb[] {
  const parts = compileBankParts(layout, site);
  const placed = placeFurniture(layout, site).map((p) => p.bounds);
  return [...parts.walls, ...parts.blocks, ...parts.furniture, ...parts.steps, ...placed];
}

interface Wall {
  /** Unit normal pointing into the room. */
  readonly n: readonly [number, number];
  /** Where the inner face crosses the axis, as a world coordinate. */
  readonly fixed: number;
  readonly alongX: boolean;
  readonly length: number;
  /** The wall's middle, world, along its length. */
  readonly mid: number;
}

function outsideWalls(layout: BankLayout, site: PlacedBank): Wall[] {
  const hw = layout.width / 2 - 0.2;
  const hd = layout.depth / 2 - 0.2;
  return [
    { n: [0, 1], fixed: site.z - hd, alongX: true, length: layout.width, mid: site.x },
    { n: [0, -1], fixed: site.z + hd, alongX: true, length: layout.width, mid: site.x },
    { n: [1, 0], fixed: site.x - hw, alongX: false, length: layout.depth, mid: site.z },
    { n: [-1, 0], fixed: site.x + hw, alongX: false, length: layout.depth, mid: site.z },
  ];
}

const place = (x: number, y: number, z: number, yaw = 0) =>
  new Matrix4().makeRotationY(yaw).setPosition(x, y, z);
const local = (parent: Matrix4, x: number, y: number, z: number, yaw = 0) =>
  new Matrix4().multiplyMatrices(parent, place(x, y, z, yaw));

export function buildBankDecor(
  map: GameMap,
  layouts: ReadonlyMap<number, BankLayout> = BANK_LAYOUTS,
): BankDecor {
  const root = new Group();
  root.name = 'bank-decor';

  // Everything plain-coloured shares one material and is painted in vertex colours.
  const solid = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    emissive: 0x2e2e2e,
  });
  const WOOD = 0x6b4a30;
  const DARK = 0x1b1d21;
  const TRIM = 0x4a3122;
  const GOLD = 0xb48a32;
  const screen = new MeshStandardMaterial({
    color: 0x0e1a2b,
    emissive: 0x9ec8ff,
    emissiveIntensity: 0.55,
    roughness: 0.3,
  });
  const skyMap = skyTexture();
  const pane = new MeshStandardMaterial({
    color: skyMap ? 0xffffff : 0xbcd9ef,
    map: skyMap ?? null,
    emissive: skyMap ? 0xffffff : 0xbcd9ef,
    emissiveMap: skyMap ?? null,
    emissiveIntensity: 0.8,
    roughness: 0.2,
  });
  const atlas = pictureAtlas();
  const pictures = new MeshStandardMaterial({
    color: atlas ? 0xffffff : 0x8a9a7a,
    map: atlas ?? null,
    emissive: atlas ? 0xffffff : 0x8a9a7a,
    emissiveMap: atlas ?? null,
    emissiveIntensity: 0.35,
    roughness: 0.7,
  });
  const glow = new MeshBasicMaterial({
    map: radialTexture('255,240,200') ?? null,
    color: 0xfff0c8,
    transparent: true,
    opacity: 0.4,
    blending: AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const blob = new MeshBasicMaterial({
    map: radialTexture('0,0,0') ?? null,
    color: 0x000000,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

  const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
  const quad = (w: number, h: number) => new PlaneGeometry(w, h);
  const flatQuad = (w: number, d: number) => new PlaneGeometry(w, d).rotateX(-Math.PI / 2);

  /** One set of batches per bank and storey: each becomes a handful of meshes BankLod can switch. */
  interface Sets {
    solid: Batch;
    screens: Batch;
    panes: Batch;
    pictures: Batch;
    pools: Batch;
    blobs: Batch;
  }
  const newSets = (): Sets => ({
    solid: new Batch(),
    screens: new Batch(),
    panes: new Batch(),
    pictures: new Batch(),
    pools: new Batch(),
    blobs: new Batch(),
  });
  const addMesh = (group: Group, batch: Batch, material: Material, name: string, order = 0) => {
    const mesh = batch.mesh(material, name);
    if (!mesh) return;
    mesh.renderOrder = order;
    group.add(mesh);
  };

  for (const site of map.banks ?? []) {
    const layout = layouts.get(site.tier);
    if (!layout) continue;
    const sets = new Map<number, Sets>();
    const S = (storey: number): Sets => {
      let set = sets.get(storey);
      if (!set) sets.set(storey, (set = newSets()));
      return set;
    };
    const h = layout.storeyHeight;
    const furniture = placeFurniture(layout, site);

    // Desk tops, monitors and keyboards over the cabinets that serve as desks.
    for (const p of furniture) {
      if (!p.desk || !isFurniturePiece(p.piece)) continue;
      const b = FURNITURE_PIECES[p.piece];
      const w = (b.max[0] - b.min[0]) * p.scale;
      const d = (b.max[2] - b.min[2]) * p.scale;
      const top = b.max[1] * p.scale;
      const parent = place(p.x, p.y, p.z, p.yaw);
      // The worker sits on the piece's back (−z) side.
      const set = S(p.storey);
      set.solid.add(box(w + 0.12, DESK_TOP, d + 0.3), local(parent, 0, top + DESK_TOP / 2, -0.15), {
        color: WOOD,
      });
      const surface = top + DESK_TOP;
      const mx = -w * 0.22;
      set.solid.add(box(0.08, 0.2, 0.08), local(parent, mx, surface + 0.1, -0.15), { color: DARK });
      set.solid.add(box(0.52, 0.34, 0.04), local(parent, mx, surface + 0.37, -0.15), {
        color: DARK,
      });
      set.screens.add(quad(0.46, 0.28), local(parent, mx, surface + 0.37, -0.172, Math.PI));
      set.solid.add(box(0.42, 0.02, 0.14), local(parent, mx, surface + 0.01, -0.45), {
        color: DARK,
      });
    }

    // Framed windows and pictures along the outside walls.
    const all = obstacles(layout, site);
    const rooms = layout.rooms ?? [];
    let count = 0;
    for (let storey = 0; storey < layout.storeys; storey++) {
      const floor = storey * h;
      for (const wall of outsideWalls(layout, site)) {
        for (
          let u = -wall.length / 2 + 2.2, j = 0;
          u < wall.length / 2 - 1.5;
          u += WALL_PITCH, j++
        ) {
          const along = wall.mid + u;
          const isWindow = j % 2 === 0;
          const half = (isWindow ? WINDOW_W : PICTURE_W) / 2 + 0.2;
          const x0 = wall.alongX ? along - half : wall.fixed;
          const x1 = wall.alongX ? along + half : wall.fixed;
          const z0 = wall.alongX ? wall.fixed : along - half;
          const z1 = wall.alongX ? wall.fixed : along + half;
          const reach = WALL_REACH;
          const spot: Aabb = {
            minX: Math.min(x0, x1 + wall.n[0] * reach),
            maxX: Math.max(x0, x1 + wall.n[0] * reach),
            minZ: Math.min(z0, z1 + wall.n[1] * reach),
            maxZ: Math.max(z0, z1 + wall.n[1] * reach),
            minY: floor + (isWindow ? WINDOW_BAND.from : PICTURE_Y - 0.4),
            maxY: floor + (isWindow ? WINDOW_BAND.to : PICTURE_Y + 0.4),
          };
          if (all.some((o) => overlaps(o, spot))) continue;
          const cx = wall.alongX ? along : wall.fixed;
          const cz = wall.alongX ? wall.fixed : along;
          const lx = cx - site.x;
          const lz = cz - site.z;
          if (
            rooms.some(
              (r) =>
                r.storey === storey &&
                r.walls === 'steel' &&
                Math.abs(lx - r.x - wall.n[0] * 0.3) <= r.width / 2 &&
                Math.abs(lz - r.z - wall.n[1] * 0.3) <= r.depth / 2,
            )
          )
            continue;
          if (
            storey === 0 &&
            wall.n[1] === -1 &&
            Math.abs(lx - layout.entrance.x) < layout.entrance.width / 2 + 0.9
          )
            continue;
          const yaw = Math.atan2(wall.n[0], wall.n[1]);
          const at = (off: number, y: number) =>
            place(cx + wall.n[0] * off, floor + y, cz + wall.n[1] * off, yaw);
          if (isWindow) {
            const set = S(storey);
            const mid = WINDOW_SILL + WINDOW_H / 2;
            set.solid.add(box(WINDOW_W + 0.16, WINDOW_H + 0.16, 0.05), at(0.025, mid), {
              color: TRIM,
            });
            set.solid.add(box(WINDOW_W + 0.34, 0.05, 0.14), at(0.07, WINDOW_SILL - 0.02), {
              color: TRIM,
            });
            set.panes.add(quad(WINDOW_W, WINDOW_H), at(0.055, mid));
            set.solid.add(box(0.04, WINDOW_H, 0.02), at(0.06, mid), { color: TRIM });
            set.solid.add(box(WINDOW_W, 0.04, 0.02), at(0.06, mid), { color: TRIM });
          } else {
            const set = S(storey);
            set.solid.add(box(PICTURE_W, PICTURE_H, 0.04), at(0.02, PICTURE_Y), { color: GOLD });
            set.pictures.add(quad(PICTURE_W - 0.12, PICTURE_H - 0.12), at(0.045, PICTURE_Y), {
              tile: count++ % PAINTINGS,
            });
          }
        }
      }
    }

    // Pools of light under every lamp, away from walls and stairwells.
    const walls = compileBankParts(layout, site).walls;
    const stairs = (layout.stairs ?? []).map((st) => ({ st, f: stairFootprint(st) }));
    const clear = (x: number, z: number, storey: number, size: number) => {
      const r = size / 2;
      if (
        walls.some(
          (w) =>
            Math.floor(w.minY / h + 0.01) === storey &&
            x > w.minX - r &&
            x < w.maxX + r &&
            z > w.minZ - r &&
            z < w.maxZ + r,
        )
      )
        return false;
      return !stairs.some(
        ({ st, f }) =>
          (st.storey === storey || st.storey + 1 === storey) &&
          x > site.x + f.minX - r &&
          x < site.x + f.maxX + r &&
          z > site.z + f.minZ - r &&
          z < site.z + f.maxZ + r,
      );
    };
    const floorY = (storey: number) => storey * h + 0.02;
    for (const spot of ceilingLightSpots(layout, site)) {
      const storey = spot.storey;
      if (clear(spot.x, spot.z, storey, POOL))
        S(storey).pools.add(flatQuad(POOL, POOL), place(spot.x, floorY(storey), spot.z));
    }
    for (const p of furniture)
      if (p.piece === 'Light_Chandelier' && clear(p.x, p.z, p.storey, POOL_CHANDELIER))
        S(p.storey).pools.add(
          flatQuad(POOL_CHANDELIER, POOL_CHANDELIER),
          place(p.x, floorY(p.storey), p.z),
        );

    // Soft shadows under things that stand on the floor.
    for (const p of furniture) {
      const b = p.bounds;
      if (NO_BLOB.test(p.piece) || b.maxY - b.minY < 0.3 || b.minY - p.storey * h > 0.1) continue;
      S(p.storey).blobs.add(
        flatQuad(b.maxX - b.minX + 0.5, b.maxZ - b.minZ + 0.5),
        place((b.minX + b.maxX) / 2, p.storey * h + 0.015, (b.minZ + b.maxZ) / 2),
      );
    }
    const bank = new Group();
    bank.name = `bank-decor-${layout.id}`;
    for (const [storey, set] of sets) {
      const group = new Group();
      group.name = `storey-${storey}`;
      group.userData = { bankTier: site.tier, storey, fine: true };
      addMesh(group, set.solid, solid, 'decor-solid');
      addMesh(group, set.screens, screen, 'screens');
      addMesh(group, set.panes, pane, 'window-panes');
      addMesh(group, set.pictures, pictures, 'pictures');
      addMesh(group, set.blobs, blob, 'soft-shadows', 1);
      addMesh(group, set.pools, glow, 'light-pools', 2);
      if (group.children.length) bank.add(group);
    }
    root.add(bank);
  }

  return {
    root,
    setNight(night) {
      pane.emissiveIntensity = 0.8 - 0.7 * night;
      screen.emissiveIntensity = 0.55 + 0.3 * night;
    },
  };
}
