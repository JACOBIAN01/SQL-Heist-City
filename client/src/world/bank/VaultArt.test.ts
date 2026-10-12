import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { HEIST_MAP, box, type MapBox } from '@heist/shared';
import { createBankMaterials } from './bankMaterials';
import { VaultArt, buildVaultDoor, poseVaultDoor } from './VaultArt';
import { VAULT_TIMING } from './vaultAnimation';

const materials = createBankMaterials();

describe('buildVaultDoor', () => {
  // A door in a wall along z (thin in x) with the console to its west.
  const door: MapBox = { ...box('interior', 4, -5.3, 0.3, 2.4, 2.4), minY: 6, maxY: 8.4 };
  const rig = buildVaultDoor(door, { x: 2.4, z: -5.3 }, materials);

  it('stands in the doorway, its face toward the console', () => {
    expect(rig.root.position.toArray()).toEqual([4, 6, -5.3]);
    // The door's own +z (its face) points west, to the console.
    const face = new Vector3(0, 0, 1).applyEuler(rig.root.rotation);
    expect(face.x).toBeCloseTo(-1);
    expect(rig.radius).toBeCloseTo(1.16);
  });

  it('swings into the vault, away from the console', () => {
    const centre = () => {
      rig.root.updateMatrixWorld(true);
      const disc = rig.pivot.children.find((c) => c.position.x > 0 && c.position.z === 0);
      return disc ? disc.getWorldPosition(new Vector3()) : new Vector3();
    };
    poseVaultDoor(rig, { wheel: 0, bolts: Array(12).fill(0), swing: 0 });
    const shut = centre();
    poseVaultDoor(rig, { wheel: 0, bolts: Array(12).fill(1), swing: 1 });
    const open = centre();
    expect(open.x).toBeGreaterThan(shut.x + 0.5); // east: into the vault
  });

  it('draws the bolts back toward the middle', () => {
    poseVaultDoor(rig, { wheel: 0, bolts: Array(12).fill(0), swing: 0 });
    const out = rig.bolts[0]?.mesh.position.x ?? 0;
    poseVaultDoor(rig, { wheel: 0, bolts: Array(12).fill(1), swing: 0 });
    expect(rig.bolts[0]?.mesh.position.x ?? 0).toBeLessThan(out);
  });
});

describe('VaultArt', () => {
  it('dresses the heist map’s vault: door, keypad, beacon, deposit boxes and cash shelves', () => {
    const art = new VaultArt(HEIST_MAP, materials);
    expect(art.root.getObjectByName('vault-door')).toBeDefined();
    art.onVaults([{ id: HEIST_MAP.vaults?.[0]?.id ?? '', tier: 1, locks: 3, opened: 0 }], 0);
    // Deposit boxes and cash: a mesh with the deposit material, and an instanced stack of notes.
    let deposit = false;
    let cash = false;
    art.root.traverse((o) => {
      const m = (o as { material?: unknown }).material;
      if (Array.isArray(m) && m.includes(materials.deposit)) deposit = true;
      if (m === materials.cash) cash = true;
    });
    expect(deposit).toBe(true);
    expect(cash).toBe(true);
  });

  it('stocks the shelves with three kinds of bundle, each tinted per bundle', () => {
    const art = new VaultArt(HEIST_MAP, materials);
    const kinds = new Set<unknown>();
    art.root.traverse((o) => {
      const mesh = o as { material?: unknown; instanceColor?: unknown; isInstancedMesh?: boolean };
      if (
        mesh.isInstancedMesh &&
        [materials.cash, materials.cashTwin, materials.cashLoose].includes(mesh.material as never)
      ) {
        kinds.add(mesh.material);
        expect(mesh.instanceColor).toBeTruthy();
      }
    });
    expect(kinds.size).toBe(3);
  });

  it('seats the door in a deep steel jamb: a sleeve through the wall, a threshold and rivets', () => {
    const door = new VaultArt(HEIST_MAP, materials).root.getObjectByName('vault-door');
    const deep = door?.children.filter(
      (c) =>
        (c as { geometry?: { parameters?: { depth?: number } } }).geometry?.parameters?.depth ===
        0.5,
    );
    expect(deep).toHaveLength(4);
    expect(door?.children.some((c) => (c as { isInstancedMesh?: boolean }).isInstancedMesh)).toBe(
      true,
    );
  });

  it('opens the door over time once the last lock falls, and flashes the alarm', () => {
    const art = new VaultArt(HEIST_MAP, materials);
    const id = HEIST_MAP.vaults?.[0]?.id ?? '';
    art.onVaults([{ id, tier: 1, locks: 3, opened: 2 }], 0);
    art.onVaults([{ id, tier: 1, locks: 3, opened: 3 }], 1);
    const door = art.root.getObjectByName('vault-door');
    const pivot = door?.children.find((c) => c.children.length > 5);
    art.update(1.1, 0.1, () => true);
    expect(pivot?.rotation.y ?? 0).toBeCloseTo(0);
    art.update(1 + VAULT_TIMING.swingDelay + VAULT_TIMING.swing + 0.5, 0.1, () => true);
    expect(pivot?.rotation.y ?? 0).toBeCloseTo(VAULT_TIMING.swingAngle);
  });
});
