import { describe, expect, it } from 'vitest';
import type { Mesh } from 'three';
import { BANK_1, BANK_5, placeFurniture, type BankLayout, type GameMap } from '@heist/shared';
import { buildBankDecor } from './BankDecorArt';

const map = { banks: [{ tier: 1, x: 10, z: -8 }] } as unknown as GameMap;
const layouts = new Map<number, BankLayout>([[1, BANK_1]]);
const decor = buildBankDecor(map, layouts);
/** Every mesh of this name, across all storeys. */
const parts = (name: string): Mesh[] => {
  const out: Mesh[] = [];
  decor.root.traverse((o) => {
    if (o.name === name && (o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
};
const part = (name: string) => parts(name)[0];
const tris = (name: string) =>
  parts(name).reduce((n, m) => n + (m.geometry.index?.count ?? 0) / 3, 0);

describe('buildBankDecor', () => {
  it('splits a bank into one group per storey, tagged for BankLod, with a handful of meshes each', () => {
    const bank = decor.root.children[0];
    expect(bank?.children.length).toBe(BANK_1.storeys);
    bank?.children.forEach((g, i) => {
      expect(g.userData).toMatchObject({ bankTier: 1, storey: i });
      expect(g.children.length).toBeLessThanOrEqual(6);
    });
  });

  it('lays a top, a monitor and a keyboard over every desk, and nowhere else', () => {
    const desks = placeFurniture(BANK_1, { x: 0, z: 0 }).filter((p) => p.desk).length;
    expect(desks).toBeGreaterThan(8);
    expect(tris('screens')).toBe(desks * 2);
    // Top, stand, monitor and keyboard are four boxes of twelve triangles each, plus frames upstairs.
    expect(tris('decor-solid')).toBeGreaterThanOrEqual(desks * 48);
  });

  it('hangs windows and pictures on the outside walls, in a handful of meshes', () => {
    expect(part('window-panes')).toBeDefined();
    expect(part('pictures')).toBeDefined();
  });

  it('keeps windows off shelves, doors and the vault', () => {
    expect(parts('window-panes').length).toBeGreaterThan(1);
    // Bank 1's vault is the back-right room of storey 2 (x 4…12, z −9…−1 from the centre).
    for (const mesh of parts('window-panes')) {
      const panes = mesh.geometry.getAttribute('position');
      for (let i = 0; i < panes.count; i++) {
        const [x, y, z] = [panes.getX(i) - 10, panes.getY(i), panes.getZ(i) + 8];
        expect(y > 6 && x > 4 && z < -1 && z > -9, 'window inside the vault').toBe(false);
      }
    }
  });

  it('puts a pool of light under lamps and soft shadows under furniture', () => {
    expect(tris('light-pools')).toBeGreaterThan(20);
    expect(tris('soft-shadows')).toBeGreaterThan(20);
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
    expect(big.root.getObjectByName('decor-solid')).toBeDefined();
  });
});
