import {
  CanvasTexture,
  Color,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { SeededRng } from '@heist/shared';

/** Every surface a bank interior or shell is drawn with. */
export type BankSurface =
  | 'marble'
  | 'wood'
  | 'carpet'
  | 'tile'
  | 'steel'
  | 'plaster'
  | 'panel'
  | 'steelWall'
  | 'ceiling'
  | 'counter'
  | 'trim'
  | 'stone'
  | 'roof';

/**
 * How a surface's texture meets the geometry. `metres`: the texture covers
 * `size` metres (floors, stone). `storey`: it spans one storey's height, so
 * the wainscot and skirting sit at the same height on every wall.
 */
export interface SurfaceStyle {
  readonly base: number;
  readonly uv: 'metres' | 'storey';
  /** Metres one texture repeat covers (`metres` mode). */
  readonly size: number;
  readonly roughness: number;
  readonly metalness: number;
  /**
   * How much the surface lights itself (0–1): interiors are lit by their own
   * lamps, not the sun, and real-time lights would cost too much.
   */
  readonly selfLight: number;
}

export const SURFACES: Readonly<Record<BankSurface, SurfaceStyle>> = {
  marble: { base: 0xe6e0d4, uv: 'metres', size: 2, roughness: 0.25, metalness: 0, selfLight: 0.35 },
  wood: { base: 0x8a5a36, uv: 'metres', size: 1, roughness: 0.55, metalness: 0, selfLight: 0.35 },
  carpet: { base: 0x2f3b52, uv: 'metres', size: 1, roughness: 0.95, metalness: 0, selfLight: 0.35 },
  tile: { base: 0xc9ccd0, uv: 'metres', size: 1, roughness: 0.4, metalness: 0, selfLight: 0.35 },
  steel: { base: 0x7d848c, uv: 'metres', size: 2, roughness: 0.35, metalness: 0.7, selfLight: 0.3 },
  plaster: {
    base: 0xd9d2c3,
    uv: 'storey',
    size: 3,
    roughness: 0.85,
    metalness: 0,
    selfLight: 0.35,
  },
  panel: { base: 0xc8bba4, uv: 'storey', size: 3, roughness: 0.7, metalness: 0, selfLight: 0.35 },
  steelWall: {
    base: 0x6f767e,
    uv: 'storey',
    size: 3,
    roughness: 0.35,
    metalness: 0.7,
    selfLight: 0.3,
  },
  ceiling: {
    base: 0xeceae4,
    uv: 'metres',
    size: 1.2,
    roughness: 0.9,
    metalness: 0,
    selfLight: 0.45,
  },
  counter: { base: 0x4a2f20, uv: 'metres', size: 1, roughness: 0.5, metalness: 0, selfLight: 0.35 },
  trim: { base: 0x3a2618, uv: 'metres', size: 1, roughness: 0.5, metalness: 0, selfLight: 0.35 },
  stone: { base: 0x9c958a, uv: 'metres', size: 2, roughness: 0.9, metalness: 0, selfLight: 0 },
  roof: { base: 0x3b3d40, uv: 'metres', size: 4, roughness: 0.95, metalness: 0, selfLight: 0 },
};

const PX = 256;
const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const shade = (c: number, f: number) => {
  const col = new Color(c).multiplyScalar(f);
  return `rgb(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)})`;
};

/**
 * Paints one surface's texture (PX × PX, covering one repeat). Each is drawn
 * in code from a fixed seed: no image files, the same look on every client.
 * Pattern: Strategy (one painter per surface) — Why: adding a finish is one
 * more painter; the geometry and material code stay as they are.
 */
const PAINTERS: Readonly<Record<BankSurface, (g: CanvasRenderingContext2D, r: SeededRng) => void>> =
  {
    marble: (g, r) => {
      // Four 1 m tiles with soft grey veins and thin grout.
      for (let i = 0; i < 4; i++) {
        g.fillStyle = shade(SURFACES.marble.base, 0.96 + r.next() * 0.06);
        g.fillRect((i % 2) * 128, Math.floor(i / 2) * 128, 128, 128);
      }
      // Fine, faint veins, mostly running one way, as in cut marble.
      g.lineWidth = 0.8;
      for (let i = 0; i < 22; i++) {
        g.strokeStyle = `rgba(120,112,104,${0.05 + r.next() * 0.1})`;
        g.beginPath();
        let x = r.next() * PX;
        let y = r.next() * PX;
        g.moveTo(x, y);
        for (let k = 0; k < 6; k++) {
          x += 6 + r.next() * 18;
          y += (r.next() - 0.5) * 14;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      grout(g, 128, 'rgba(120,112,100,0.6)');
    },
    wood: (g, r) => {
      // Planks 20 cm wide, staggered ends, grain lines.
      const plank = PX / 5;
      for (let i = 0; i < 5; i++) {
        const offset = r.next() * PX;
        for (const start of [offset - PX, offset]) {
          g.fillStyle = shade(SURFACES.wood.base, 0.8 + r.next() * 0.35);
          g.fillRect(i * plank, start, plank - 2, PX * 0.75);
        }
        g.strokeStyle = 'rgba(40,22,10,0.25)';
        for (let k = 0; k < 4; k++) {
          const x = i * plank + 4 + r.next() * (plank - 8);
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x + (r.next() - 0.5) * 6, PX);
          g.stroke();
        }
      }
    },
    carpet: (g, r) => {
      g.fillStyle = css(SURFACES.carpet.base);
      g.fillRect(0, 0, PX, PX);
      for (let i = 0; i < 3000; i++) {
        g.fillStyle = `rgba(${r.next() < 0.5 ? '255,255,255' : '0,0,0'},0.06)`;
        g.fillRect(r.next() * PX, r.next() * PX, 2, 2);
      }
    },
    tile: (g, r) => {
      for (let i = 0; i < 4; i++) {
        g.fillStyle = shade(SURFACES.tile.base, 0.95 + r.next() * 0.08);
        g.fillRect((i % 2) * 128, Math.floor(i / 2) * 128, 128, 128);
      }
      grout(g, 128, 'rgba(90,92,96,0.7)');
    },
    steel: (g, r) => {
      brushed(g, r, SURFACES.steel.base);
      // Plates 1 m square with rivets at the corners.
      grout(g, 128, 'rgba(40,44,48,0.8)');
      g.fillStyle = 'rgba(30,32,36,0.8)';
      for (const x of [8, 120, 136, 248])
        for (const y of [8, 120, 136, 248]) g.fillRect(x - 2, y - 2, 4, 4);
    },
    plaster: (g, r) => wainscot(g, r, SURFACES.plaster.base, 0x5b3d29),
    panel: (g, r) => wainscot(g, r, SURFACES.panel.base, 0x4a3122),
    steelWall: (g, r) => {
      brushed(g, r, SURFACES.steelWall.base);
      // Horizontal plate seams every 75 cm and a bolt line.
      g.fillStyle = 'rgba(35,38,42,0.85)';
      for (let y = 0; y < PX; y += PX / 4) g.fillRect(0, y, PX, 3);
      for (let x = 10; x < PX; x += 32)
        for (let y = 10; y < PX; y += PX / 4) g.fillRect(x, y, 4, 4);
    },
    ceiling: (g) => {
      g.fillStyle = css(SURFACES.ceiling.base);
      g.fillRect(0, 0, PX, PX);
      grout(g, PX / 2, 'rgba(150,148,140,0.5)');
    },
    counter: (g, r) => {
      // Vertical panels with a darker frame.
      g.fillStyle = css(SURFACES.counter.base);
      g.fillRect(0, 0, PX, PX);
      g.strokeStyle = 'rgba(15,8,4,0.6)';
      g.lineWidth = 6;
      g.strokeRect(14, 14, PX / 2 - 28, PX - 28);
      g.strokeRect(PX / 2 + 14, 14, PX / 2 - 28, PX - 28);
      g.strokeStyle = 'rgba(15,8,4,0.15)';
      g.lineWidth = 1;
      for (let i = 0; i < 30; i++) {
        const x = r.next() * PX;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, PX);
        g.stroke();
      }
    },
    trim: (g) => {
      g.fillStyle = css(SURFACES.trim.base);
      g.fillRect(0, 0, PX, PX);
    },
    stone: (g, r) => {
      // Ashlar: 50 × 30 cm blocks in courses.
      const w = PX / 4;
      const h = PX / (2 / 0.3);
      for (let row = 0, y = 0; y < PX; row++, y += h)
        for (let x = row % 2 ? -w / 2 : 0; x < PX; x += w) {
          g.fillStyle = shade(SURFACES.stone.base, 0.88 + r.next() * 0.2);
          g.fillRect(x + 1, y + 1, w - 2, h - 2);
        }
    },
    roof: (g, r) => {
      g.fillStyle = css(SURFACES.roof.base);
      g.fillRect(0, 0, PX, PX);
      for (let i = 0; i < 1500; i++) {
        g.fillStyle = `rgba(255,255,255,${r.next() * 0.05})`;
        g.fillRect(r.next() * PX, r.next() * PX, 2, 2);
      }
    },
  };

function grout(g: CanvasRenderingContext2D, step: number, colour: string): void {
  g.fillStyle = colour;
  for (let p = 0; p < PX; p += step) {
    g.fillRect(p, 0, 2, PX);
    g.fillRect(0, p, PX, 2);
  }
}

function brushed(g: CanvasRenderingContext2D, r: SeededRng, base: number): void {
  g.fillStyle = css(base);
  g.fillRect(0, 0, PX, PX);
  for (let y = 0; y < PX; y++) {
    g.fillStyle = `rgba(255,255,255,${r.next() * 0.06})`;
    g.fillRect(0, y, PX, 1);
  }
}

/**
 * A wall one storey tall (the texture spans 3 m): plaster above, a wood
 * wainscot to 0.9 m with a rail, and a dark skirting board at the floor.
 * Canvas y runs down, so the floor is at the bottom of the image.
 */
function wainscot(g: CanvasRenderingContext2D, r: SeededRng, wall: number, wood: number): void {
  const m = PX / 3; // pixels per metre
  g.fillStyle = css(wall);
  g.fillRect(0, 0, PX, PX);
  for (let i = 0; i < 1200; i++) {
    g.fillStyle = `rgba(0,0,0,${r.next() * 0.03})`;
    g.fillRect(r.next() * PX, r.next() * PX * 0.7, 2, 2);
  }
  // Cornice band under the ceiling.
  g.fillStyle = shade(wall, 0.85);
  g.fillRect(0, 0, PX, 0.08 * m);
  g.fillStyle = css(wood);
  g.fillRect(0, PX - 0.9 * m, PX, 0.9 * m);
  g.fillStyle = shade(wood, 1.35);
  g.fillRect(0, PX - 0.95 * m, PX, 0.05 * m); // the rail
  g.strokeStyle = shade(wood, 0.7);
  g.lineWidth = 3;
  for (let x = 0; x < PX; x += PX / 4) g.strokeRect(x + 6, PX - 0.82 * m, PX / 4 - 12, 0.6 * m);
  g.fillStyle = shade(wood, 0.55);
  g.fillRect(0, PX - 0.12 * m, PX, 0.12 * m); // skirting
}

function paint(surface: BankSurface): Texture | undefined {
  const canvas = typeof document === 'undefined' ? undefined : document.createElement('canvas');
  const g = canvas?.getContext('2d');
  if (!canvas || !g) return undefined; // no canvas (tests, headless): plain colours
  canvas.width = PX;
  canvas.height = PX;
  PAINTERS[surface](g, new SeededRng(`bank-surface:${surface}`));
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export type BankMaterials = Readonly<Record<BankSurface, MeshStandardMaterial>>;

/**
 * One material per surface, shared by every bank. Textures are painted once,
 * on first use. Interiors light themselves a little (`selfLight`), so a room
 * the sun never reaches still reads.
 */
export function createBankMaterials(): BankMaterials {
  const out = {} as Record<BankSurface, MeshStandardMaterial>;
  for (const key of Object.keys(SURFACES) as BankSurface[]) {
    const s = SURFACES[key];
    const map = paint(key);
    const material = new MeshStandardMaterial({
      name: `bank-${key}`,
      color: map ? 0xffffff : s.base,
      roughness: s.roughness,
      metalness: s.metalness,
      ...(map ? { map, emissiveMap: map } : {}),
      emissive: new Color(map ? 0xffffff : s.base).multiplyScalar(s.selfLight),
    });
    out[key] = material;
  }
  return out;
}
