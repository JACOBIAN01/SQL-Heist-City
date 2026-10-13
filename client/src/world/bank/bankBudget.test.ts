// @vitest-environment node
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InstancedMesh, Mesh, type BufferGeometry, type Object3D, Scene } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BANK_LAYOUTS, cityMapById } from '@heist/shared';
import { buildBankDecor } from './BankDecorArt';
import { buildBankFacades } from './BankFacadeArt';
import { buildBankFixtures } from './BankFixturesArt';
import { buildBankFurniture } from './BankFurnitureArt';
import { buildBankShells } from './BankShellArt';
import { BankLod } from './BankLod';
import { createBankMaterials } from './bankMaterials';
import { interiorKitFrom, type InteriorManifest } from './InteriorKit';
import { VaultArt } from './VaultArt';

/**
 * Draw calls and triangles of one bank's art that are visible (frustum ignored:
 * the worst case of looking everywhere). Banks stand 100 m or more apart, so a
 * frame holds one bank's inside and at most a glimpse of another's front.
 */
function drawn(
  root: Object3D,
  bank: { id: string; tier: number },
): { calls: number; triangles: number } {
  let calls = 0;
  let triangles = 0;
  const visible = (o: Object3D): boolean => {
    for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const mine = (o: Object3D): boolean => {
    for (let p: Object3D | null = o; p; p = p.parent)
      if (
        p.userData.bankTier === bank.tier ||
        p.name.endsWith(`-${bank.id}`) ||
        p.name.includes(`${bank.id}:`)
      )
        return true;
    return false;
  };
  root.traverse((o) => {
    if (!(o instanceof Mesh) || !visible(o) || !mine(o)) return;
    const g = o.geometry as BufferGeometry;
    const n = (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
    calls += Array.isArray(o.material) ? o.material.length : 1;
    triangles += n * (o instanceof InstancedMesh ? o.count : 1);
  });
  return { calls, triangles };
}

async function realKit() {
  // Vitest runs from the repo root or from client/; find the built kit either way.
  const dir = ['client/public/interior', 'public/interior']
    .map((d) => resolve(process.cwd(), d))
    .find((d) => existsSync(resolve(d, 'interior.glb')));
  if (!dir) throw new Error('interior kit not found (run tools/city/build-interior.mjs)');
  const glb = readFileSync(resolve(dir, 'interior.glb'));
  const manifest = JSON.parse(
    readFileSync(resolve(dir, 'interior.json'), 'utf8'),
  ) as InteriorManifest;
  const buffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  return interiorKitFrom(gltf.scene, manifest);
}

/**
 * The frame budget for bank art (docs/frontend.md "Budgets"): the whole frame
 * is held to < 200 draw calls and < 400k triangles, with the city taking
 * about 60 calls and a crowd of players about 3 each, so one bank may take
 * only a slice of it.
 */
export const BANK_BUDGET = {
  /** One bank anywhere: inside on any storey, or its front from the street. */
  calls: 50,
  triangles: 80_000,
  /** A bank's outside alone (seen from afar). */
  outsideCalls: 16,
} as const;

describe('bank art budget (11.10)', async () => {
  const map = cityMapById('city');
  if (!map?.banks) throw new Error('no city');
  const materials = createBankMaterials();
  const kit = await realKit();
  const scene = new Scene();
  const lod = new BankLod(map.banks, BANK_LAYOUTS);
  const parts: Object3D[] = [
    buildBankShells(map, materials),
    buildBankFixtures(map, materials),
    buildBankDecor(map).root,
    buildBankFacades(map, materials).root,
    buildBankFurniture(kit, map),
    new VaultArt(map, materials).root,
  ];
  for (const p of parts) {
    scene.add(p);
    lod.add(p);
  }

  const cases = map.banks.flatMap((site) => {
    const layout = BANK_LAYOUTS.get(site.tier);
    if (!layout) return [];
    const h = layout.storeyHeight;
    const bank = { id: layout.id, tier: site.tier };
    return [
      ...Array.from({ length: layout.storeys }, (_, s) => ({
        what: `inside ${layout.name}, storey ${s}`,
        bank,
        at: [site.x, s * h, site.z] as const,
      })),
      {
        what: `street at ${layout.name}`,
        bank,
        at: [site.x, 0, site.z + layout.depth / 2 + 8] as const,
      },
    ];
  });

  it("draws only a bank's outside from afar, in a handful of meshes", () => {
    for (const site of map.banks ?? []) {
      const layout = BANK_LAYOUTS.get(site.tier);
      if (!layout) continue;
      lod.update(site.x, 0, site.z + 1e4);
      const { calls } = drawn(scene, { id: layout.id, tier: site.tier });
      expect(calls, layout.name).toBeLessThanOrEqual(BANK_BUDGET.outsideCalls);
    }
  });

  it.each(cases.map((c) => [c.what, c] as const))('%s stays inside the budget', (_what, c) => {
    lod.update(...c.at);
    const { calls, triangles } = drawn(scene, c.bank);
    expect(calls, 'draw calls').toBeLessThanOrEqual(BANK_BUDGET.calls);
    expect(triangles, 'triangles').toBeLessThanOrEqual(BANK_BUDGET.triangles);
  });

  it('writes the numbers down for the docs', () => {
    const rows = cases.map((c) => {
      lod.update(...c.at);
      const d = drawn(scene, c.bank);
      return `${c.what}\t${d.calls}\t${d.triangles}`;
    });
    if (process.env.BANK_BUDGET_OUT)
      appendFileSync(process.env.BANK_BUDGET_OUT, rows.join('\n') + '\n');
    expect(rows.length).toBe(cases.length);
  });
});
