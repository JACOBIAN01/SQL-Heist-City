import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { BANK_LAYOUTS, type BankLayout, type GameMap, type PlacedBank } from '@heist/shared';
import { mergeByMaterial } from '../../render/mergeByMaterial';
import { SURFACES, type BankMaterials, type BankSurface } from './bankMaterials';

/** Building skin: the outer face of the stone wall is at this distance from the footprint's edge. */
const WALL_OUT = 0.2;
/** Storey 0's top: the cornice runs here. */
const CORNICE_Y = 3.0;

/** A box whose texture repeats once per `SURFACES[surface].size` metres, so pilasters are not stretched. */
function solid(
  w: number,
  h: number,
  d: number,
  surface: BankSurface,
  materials: BankMaterials,
): Mesh {
  const geo = new BoxGeometry(w, h, d);
  const uv = geo.getAttribute('uv');
  const size = SURFACES[surface].size;
  // Face order: +x, −x (d × h), +y, −y (w × d), +z, −z (w × h); four vertices each.
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  dims.forEach(([a, b], face) => {
    for (let i = face * 4; i < face * 4 + 4; i++)
      uv.setXY(i, (uv.getX(i) * a) / size, (uv.getY(i) * b) / size);
  });
  return new Mesh(geo, materials[surface]);
}

/** The name plaque: dark green with a gold border and the bank's name in capitals (plain when there is no canvas). */
function plaqueMaterial(name: string): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    name: 'bank-plaque',
    color: 0x14301f,
    roughness: 0.5,
    metalness: 0.2,
    emissive: 0xffd34d,
    emissiveIntensity: 0.05,
  });
  const canvas = typeof document === 'undefined' ? undefined : document.createElement('canvas');
  const g = canvas?.getContext('2d');
  if (!canvas || !g) return material;
  canvas.width = 1024;
  canvas.height = 128;
  g.fillStyle = '#14301f';
  g.fillRect(0, 0, 1024, 128);
  g.strokeStyle = '#d4a017';
  g.lineWidth = 6;
  g.strokeRect(8, 8, 1008, 112);
  g.fillStyle = '#e8c35a';
  g.font = 'bold 74px Georgia, "Times New Roman", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name.toUpperCase(), 512, 70, 960);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  material.map = map;
  material.emissiveMap = map;
  material.color.setHex(0xffffff);
  material.emissive.setHex(0xffffff);
  return material;
}

/** What the caller needs to keep the facade lit in step with the sky. */
export interface FacadeArt {
  readonly root: Group;
  /** 0 by day … 1 at night: lanterns, the plaque and the cash machine's screen brighten. */
  setNight(night: number): void;
}

interface Glow {
  readonly material: MeshStandardMaterial;
  readonly day: number;
  readonly night: number;
}

/**
 * Dresses a bank's street front from its layout (`facade`): engaged columns
 * with bases and capitals, a cornice, a lintel and jambs round the door, a
 * name plaque, a doorstep, the double doors propped open, lanterns and a
 * cash machine. Art only: nothing here collides, and none of it changes the
 * footprint the city reserves.
 */
export function buildFacade(
  layout: BankLayout,
  site: PlacedBank,
  materials: BankMaterials,
): FacadeArt {
  const root = new Group();
  root.name = `bank-facade-${layout.id}`;
  const glows: Glow[] = [];
  const front = site.z + layout.depth / 2 + WALL_OUT;
  const spec = layout.facade;
  const put = (m: Mesh, x: number, y: number, z: number): Mesh => {
    m.position.set(site.x + x, y, front + z);
    root.add(m);
    return m;
  };
  const entrance = layout.entrance;
  const doorHalf = entrance.width / 2;

  // The doorstep, flush with the pavement, and the sill of the doorway.
  put(
    solid(entrance.width + 1.2, 0.03, 1.1, layout.cladding ?? 'stone', materials),
    entrance.x,
    0.02,
    0.55,
  );
  put(solid(entrance.width, 0.04, 0.5, 'brass', materials), entrance.x, 0.02, -0.05);
  // Lintel and jambs: a heavy frame in cream stone.
  const frameH = entrance.height;
  put(solid(entrance.width + 0.9, 0.4, 0.34, 'marble', materials), entrance.x, frameH + 0.2, 0.17);
  for (const side of [-1, 1])
    put(
      solid(0.3, frameH + 0.2, 0.3, 'marble', materials),
      entrance.x + side * (doorHalf + 0.15),
      (frameH + 0.2) / 2,
      0.15,
    );

  // Both leaves propped open, hinged at the jambs and swung against the lobby's front wall.
  for (const side of [-1, 1]) {
    const leaf = solid(0.06, frameH - 0.1, doorHalf - 0.1, 'counter', materials);
    put(
      leaf,
      entrance.x + side * (doorHalf - 0.08),
      (frameH - 0.1) / 2,
      -0.45 - (doorHalf - 0.1) / 2,
    );
    const plate = solid(0.02, 0.3, 0.12, 'brass', materials);
    put(plate, entrance.x + side * (doorHalf - 0.08 - 0.045), 1.1, -0.5 - doorHalf + 0.35);
  }

  for (const x of spec?.pilasters ?? []) {
    put(solid(0.62, 0.22, 0.3, 'marble', materials), x, 0.11, 0.15); // base
    put(
      solid(0.46, CORNICE_Y - 0.55, 0.22, 'marble', materials),
      x,
      0.22 + (CORNICE_Y - 0.55) / 2,
      0.11,
    ); // shaft
    put(solid(0.66, 0.2, 0.32, 'marble', materials), x, CORNICE_Y - 0.43 + 0.1, 0.16); // capital
  }
  if (spec?.pilasters?.length)
    // The cornice: a band along the whole front above the ground storey.
    put(solid(layout.width + 0.7, 0.24, 0.42, 'marble', materials), 0, CORNICE_Y + 0.12, 0.21);

  if (spec?.sign) {
    const plaque = new Mesh(new BoxGeometry(6.4, 0.8, 0.1), plaqueMaterial(layout.name));
    // BoxGeometry's +z face carries the canvas; the others are plain.
    put(plaque, entrance.x, CORNICE_Y + 0.9, 0.06);
    glows.push({ material: plaque.material as MeshStandardMaterial, day: 0.08, night: 0.9 });
    put(solid(6.6, 0.06, 0.16, 'brass', materials), entrance.x, CORNICE_Y + 1.33, 0.08);
    put(solid(6.6, 0.06, 0.16, 'brass', materials), entrance.x, CORNICE_Y + 0.47, 0.08);
  }

  for (const x of spec?.lamps ?? []) {
    put(solid(0.05, 0.05, 0.28, 'brass', materials), x, 2.5, 0.14);
    const bulbMaterial = new MeshStandardMaterial({
      color: 0xffe9b0,
      emissive: 0xffc860,
      emissiveIntensity: 0.3,
      roughness: 0.4,
    });
    const bulb = new Mesh(new CylinderGeometry(0.1, 0.07, 0.3, 12), bulbMaterial);
    put(bulb, x, 2.42, 0.3);
    put(solid(0.26, 0.04, 0.26, 'brass', materials), x, 2.6, 0.3);
    glows.push({ material: bulbMaterial, day: 0.3, night: 2.6 });
  }

  if (spec?.atm !== undefined) {
    const x = spec.atm;
    put(solid(0.9, 1.7, 0.38, 'steel', materials), x, 1.15, 0.19);
    put(solid(0.96, 0.12, 0.42, 'steel', materials), x, 2.05, 0.21); // hood
    const screen = new MeshStandardMaterial({
      color: 0x0a2a14,
      emissive: 0x33ff88,
      emissiveIntensity: 0.6,
      roughness: 0.2,
    });
    const display = new Mesh(new PlaneGeometry(0.5, 0.34), screen);
    display.position.set(site.x + x, 1.62, front + 0.385);
    root.add(display);
    glows.push({ material: screen, day: 0.6, night: 1.6 });
    put(solid(0.4, 0.18, 0.1, 'deposit', materials), x - 0.04, 1.2, 0.43); // keypad
    put(solid(0.36, 0.05, 0.04, 'brass', materials), x, 0.88, 0.4); // card slot plate
    put(solid(0.3, 0.07, 0.06, 'brass', materials), x, 0.76, 0.41); // cash tray
  }

  // One mesh per material: the facade's forty-odd pieces cost a few draw calls.
  const flat = mergeByMaterial(root, root.name);
  flat.userData = { bankTier: site.tier, exterior: true };
  const facade: FacadeArt = {
    root: flat,
    setNight(night) {
      for (const g of glows) g.material.emissiveIntensity = g.day + (g.night - g.day) * night;
    },
  };
  facade.setNight(0);
  return facade;
}

/** Dresses every bank's front. */
export function buildBankFacades(
  map: GameMap,
  materials: BankMaterials,
  layouts: ReadonlyMap<number, BankLayout> = BANK_LAYOUTS,
): FacadeArt {
  const root = new Group();
  root.name = 'bank-facades';
  const parts: FacadeArt[] = [];
  for (const site of map.banks ?? []) {
    const layout = layouts.get(site.tier);
    if (!layout?.facade) continue;
    const part = buildFacade(layout, site, materials);
    parts.push(part);
    root.add(part.root);
  }
  return { root, setNight: (n) => parts.forEach((p) => p.setNight(n)) };
}
