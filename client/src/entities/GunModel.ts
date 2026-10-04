import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three';

const METAL = new MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.45, metalness: 0.7 });
const WOOD = new MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.8 });
const GLASS = new MeshStandardMaterial({ color: 0x223344, roughness: 0.2, metalness: 0.3 });

interface Part {
  readonly size: [number, number, number];
  readonly at: [number, number, number];
  readonly material?: MeshStandardMaterial;
  /** A round barrel instead of a box (length along z). */
  readonly round?: boolean;
}

/**
 * Guns are a few boxes and tubes each, built along −z (the barrel points forward)
 * with the grip at the origin, so any gun sits in a hand the same way.
 * Presentation only: stats, range and spread come from the server's weapon table.
 */
const PARTS: Readonly<Record<string, readonly Part[]>> = {
  pistol: [
    { size: [0.035, 0.05, 0.2], at: [0, 0.03, -0.08] },
    { size: [0.03, 0.09, 0.04], at: [0, -0.04, 0.0] },
  ],
  smg: [
    { size: [0.045, 0.07, 0.3], at: [0, 0.03, -0.14] },
    { size: [0.03, 0.14, 0.04], at: [0, -0.08, -0.12] },
    { size: [0.03, 0.09, 0.04], at: [0, -0.05, 0.02] },
  ],
  shotgun: [
    { size: [0.04, 0.045, 0.62], at: [0, 0.03, -0.3] },
    { size: [0.05, 0.05, 0.22], at: [0, -0.01, -0.28], material: WOOD },
    { size: [0.04, 0.07, 0.22], at: [0, 0.0, 0.14], material: WOOD },
  ],
  rifle: [
    { size: [0.045, 0.075, 0.5], at: [0, 0.03, -0.22] },
    { size: [0.02, 0.02, 0.35], at: [0, 0.04, -0.62], round: true },
    { size: [0.03, 0.14, 0.05], at: [0, -0.08, -0.16] },
    { size: [0.045, 0.09, 0.26], at: [0, 0.0, 0.14], material: WOOD },
  ],
  sniper: [
    { size: [0.04, 0.07, 0.66], at: [0, 0.03, -0.3] },
    { size: [0.018, 0.018, 0.4], at: [0, 0.04, -0.82], round: true },
    { size: [0.05, 0.05, 0.22], at: [0, 0.1, -0.22], material: GLASS },
    { size: [0.045, 0.1, 0.28], at: [0, 0.0, 0.16], material: WOOD },
  ],
};

/** A gun for `weaponId`, or undefined for an id with no model. */
export function createGun(weaponId: string): Group | undefined {
  const parts = PARTS[weaponId];
  if (!parts) return undefined;
  const gun = new Group();
  gun.name = `gun-${weaponId}`;
  for (const p of parts) {
    const [w, h, d] = p.size;
    const geometry = p.round ? new CylinderGeometry(w / 2, w / 2, d, 8) : new BoxGeometry(w, h, d);
    const mesh = new Mesh(geometry, p.material ?? METAL);
    if (p.round) mesh.rotation.x = Math.PI / 2;
    mesh.position.set(...p.at);
    mesh.castShadow = true;
    gun.add(mesh);
  }
  return gun;
}
