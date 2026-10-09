import { describe, expect, it } from 'vitest';
import type { MeshStandardMaterial } from 'three';
import { Box3, type Mesh } from 'three';
import { BANK_1, HEIST_MAP, validateBank, type BankLayout } from '@heist/shared';
import { buildBankFacades, buildFacade } from './BankFacadeArt';
import { createBankMaterials } from './bankMaterials';

const materials = createBankMaterials();
const site = { tier: 1, x: 20, z: -10 };
const art = buildFacade(BANK_1, site, materials);
const bounds = new Box3().setFromObject(art.root);
const front = site.z + BANK_1.depth / 2;

describe('bank facade', () => {
  it('stands on the street front, a little proud of the wall, and no further than a cornice', () => {
    expect(bounds.min.z).toBeGreaterThan(front - 2.8); // only the propped-open door leaves go inside
    expect(bounds.max.z).toBeLessThan(front + 1.6); // the doorstep is the deepest piece
    expect(bounds.max.x).toBeLessThan(site.x + BANK_1.width / 2 + 0.5);
    expect(bounds.min.x).toBeGreaterThan(site.x - BANK_1.width / 2 - 0.5);
  });

  it('puts a plaque with the bank name over the door, above the ground storey', () => {
    let plaque: Mesh | undefined;
    art.root.traverse((o) => {
      const m = (o as Mesh).material as MeshStandardMaterial | undefined;
      if (m?.name === 'bank-plaque') plaque = o as Mesh;
    });
    expect(plaque).toBeDefined();
    expect(plaque?.position.x).toBeCloseTo(site.x);
    expect(plaque?.position.y).toBeGreaterThan(3);
  });

  it('keeps the doorway clear: nothing but the sill stands between the jambs', () => {
    const half = BANK_1.entrance.width / 2;
    const leaves = art.root.children.filter((c) => {
      const b = new Box3().setFromObject(c);
      return (
        b.min.y < 1 &&
        b.max.y > 1 &&
        b.max.x > site.x - half + 0.2 &&
        b.min.x < site.x + half - 0.2 &&
        b.max.z > front + 0.001
      );
    });
    // The open leaves swing inside the wall line (z < front), so none block the way.
    expect(leaves).toHaveLength(0);
  });

  it('brightens its lanterns, plaque and cash machine at night', () => {
    const emissive = () => {
      const out: number[] = [];
      art.root.traverse((o) => {
        const m = (o as Mesh).material as MeshStandardMaterial | undefined;
        if (m && ['bank-plaque'].includes(m.name)) out.push(m.emissiveIntensity);
        else if (m && m.emissiveIntensity > 0 && m.emissive.getHex() !== 0)
          out.push(m.emissiveIntensity);
      });
      return out;
    };
    art.setNight(0);
    const day = emissive();
    art.setNight(1);
    const night = emissive();
    expect(night.length).toBe(day.length);
    expect(Math.max(...night)).toBeGreaterThan(Math.max(...day) * 2);
  });

  it('is only built for banks that have a facade', () => {
    expect(buildBankFacades(HEIST_MAP, materials).root.children).toHaveLength(1);
    expect(buildBankFacades({ ...HEIST_MAP, banks: [] }, materials).root.children).toHaveLength(0);
    const plain = new Map<number, BankLayout>([
      [1, { ...BANK_1, facade: undefined } as unknown as BankLayout],
    ]);
    expect(buildBankFacades(HEIST_MAP, materials, plain).root.children).toHaveLength(0);
  });

  it('refuses a facade fitting off the front of the bank', () => {
    expect(() => validateBank({ ...BANK_1, facade: { atm: 14 } })).toThrow(/off the front/);
  });
});
