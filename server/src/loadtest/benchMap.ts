import { SeededRng, box, type GameMap, type MapBox, type SpawnPoint } from '@heist/shared';

/**
 * A city-sized stand-in for load tests: an open square with hundreds of
 * building-sized boxes on a street grid, so spatial indexing and area-of-
 * interest behave as they will in the real city (docs/city-kit.md) instead of
 * on the tiny sandbox yard. Deterministic per seed.
 */
export function makeBenchMap(halfSize = 320, seed = 'bench'): GameMap {
  const rng = new SeededRng(seed);
  const boxes: MapBox[] = [];
  const pitch = 64; // one block per 64 m cell, like the real layout
  const spawns: SpawnPoint[] = [];
  for (let gx = -halfSize + pitch / 2; gx < halfSize; gx += pitch) {
    for (let gz = -halfSize + pitch / 2; gz < halfSize; gz += pitch) {
      // A block holds a few buildings; streets (the 12 m between blocks) stay clear.
      for (let i = 0; i < 4; i++) {
        const w = rng.int(8, 20);
        const d = rng.int(8, 20);
        const x = gx + rng.int(-12, 12);
        const z = gz + rng.int(-12, 12);
        boxes.push(box('building', x, z, w, rng.int(6, 25), d));
      }
      spawns.push({ x: gx + 28, z: gz + 28, yaw: rng.next() * Math.PI * 2 });
    }
  }
  // Boundary walls, as in the sandbox.
  const h = halfSize;
  boxes.push(
    box('wall', 0, -h - 0.5, h * 2 + 2, 4, 1),
    box('wall', 0, h + 0.5, h * 2 + 2, 4, 1),
    box('wall', -h - 0.5, 0, 1, 4, h * 2 + 2),
    box('wall', h + 0.5, 0, 1, 4, h * 2 + 2),
  );
  return { id: `bench-${halfSize}`, halfSize, boxes, spawns };
}
