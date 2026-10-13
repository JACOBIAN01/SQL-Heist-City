import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';

// Shared by every pile: notes, the paper band round each bundle.
const NOTES = new MeshStandardMaterial({
  color: 0x7e9a6a,
  roughness: 0.8,
  emissive: 0x7e9a6a,
  emissiveIntensity: 0.25,
});
const BAND = new MeshStandardMaterial({ color: 0xe8e2c8, roughness: 0.7 });
const BUNDLE = new BoxGeometry(0.16, 0.035, 0.07);
const STRAP = new BoxGeometry(0.03, 0.037, 0.072);

/** Where the bundles of a pile lie (x, layer, z, turn): two side by side, one on top, a little askew. */
const LAYOUT: readonly (readonly [number, number, number, number])[] = [
  [-0.05, 0, 0, 0.05],
  [0.06, 0, 0.01, -0.12],
  [0, 1, 0.005, 0.3],
];

/**
 * Loose office cash (12.1): a few banded bundles of notes lying on a desk.
 * Small and still, unlike a bag, so it reads as money left out rather than
 * loot. Origin is the bottom centre.
 */
export function createCashStack(): Group {
  const pile = new Group();
  pile.name = 'cash-stack';
  for (const [x, layer, z, turn] of LAYOUT) {
    const bundle = new Mesh(BUNDLE, NOTES);
    bundle.position.set(x, 0.0175 + layer * 0.035, z);
    bundle.rotation.y = turn;
    const strap = new Mesh(STRAP, BAND);
    bundle.add(strap);
    pile.add(bundle);
  }
  return pile;
}
