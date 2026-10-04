import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';

// One geometry and material for every bag in the scene: hundreds of carried bags cost no extra memory.
const BODY = new BoxGeometry(0.42, 0.34, 0.26);
const KNOT = new BoxGeometry(0.16, 0.1, 0.12);
const SACK = new MeshStandardMaterial({ color: 0x2f7d4a, roughness: 0.9 });
const TIE = new MeshStandardMaterial({ color: 0xd8c27a, roughness: 0.7 });

/** A cash bag: a green sack with a tied top. The origin is the bottom centre. */
export function createCashBag(): Group {
  const bag = new Group();
  const body = new Mesh(BODY, SACK);
  body.position.y = 0.17;
  const knot = new Mesh(KNOT, TIE);
  knot.position.y = 0.39;
  bag.add(body, knot);
  return bag;
}
