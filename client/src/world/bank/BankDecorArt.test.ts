import { describe, expect, it } from 'vitest';
import type { Mesh } from 'three';
import { BANK_1, BANK_5, placeFurniture, type BankLayout, type GameMap } from '@heist/shared';
import { buildBankDecor } from './BankDecorArt';

const map = { banks: [{ tier: 1, x: 10, z: -8 }] } as unknown as GameMap;
const layouts = new Map<number, BankLayout>([[1, BANK_1]]);
const decor = buildBankDecor(map, layouts);
const part = (name: string) => decor.root.getObjectByName(name) as Mesh | undefined;
const tris = (m?: Mesh) => (m?.geometry.index?.count ?? 0) / 3;

describe('buildBankDecor', () => {
  it('lays a top, a monitor and a keyboard over every desk, and nowhere else', () => {
    const desks = placeFurniture(BANK_1, { x: 0, z: 0 }).filter((p) => p.desk).length;
    expect(desks).toBeGreaterThan(8);
    expect(tris(part('desk-tops'))).toBe(desks * 12);
    expect(tris(part('keyboards'))).toBe(desks * 12);
    expect(tris(part('screens'))).toBe(desks * 2);
  });

  it('hangs windows and pictures on the outside walls, in a handful of meshes', () => {
    expect(part('window-panes')).toBeDefined();
    expect(part('picture-frames')).toBeDefined();
    expect(decor.root.children.length).toBeLessThan(16);
  });

  it('keeps windows off shelves, doors and the vault', () => {
    const panes = part('window-panes')?.geometry.getAttribute('position');
    if (!panes) throw new Error('no windows');
    // Bank 1's vault is the back-right room of storey 2 (x 4…12, z −9…−1 from the centre).
    for (let i = 0; i < panes.count; i++) {
      const [x, y, z] = [panes.getX(i) - 10, panes.getY(i), panes.getZ(i) + 8];
      expect(y > 6 && x > 4 && z < -1 && z > -9, 'window inside the vault').toBe(false);
    }
  });

  it('puts a pool of light under lamps and soft shadows under furniture', () => {
    expect(tris(part('light-pools'))).toBeGreaterThan(20);
    expect(tris(part('soft-shadows'))).toBeGreaterThan(20);
  });

  it('darkens the windows at night', () => {
    const pane = part('window-panes')?.material as unknown as {
      emissiveIntensity: number;
    };
    decor.setNight(0);
    const day = pane.emissiveIntensity;
    decor.setNight(1);
    expect(pane.emissiveIntensity).toBeLessThan(day);
  });

  it('dresses a bigger bank too', () => {
    const big = buildBankDecor(
      { banks: [{ tier: 5, x: 0, z: 0 }] } as unknown as GameMap,
      new Map([[5, BANK_5]]),
    );
    expect(big.root.getObjectByName('desk-tops')).toBeDefined();
  });
});
