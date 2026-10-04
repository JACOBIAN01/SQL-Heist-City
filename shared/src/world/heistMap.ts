import { box, type GameMap, type SpawnPoint } from './map';
import { compileBankWorld } from './bank/compileBank';
import { BANK_1 } from './bank/bank1';

const HALF = 60;
const WALL_HEIGHT = 4;
const BANK_1_WORLD = compileBankWorld(BANK_1, { x: 0, z: 0 });

/** Spawns on a ring, facing the bank in the middle. */
function ring(count: number, radius: number): SpawnPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, yaw: angle + Math.PI / 2 };
  });
}

/**
 * Phase 7 playground: Bank 1 alone on a walled lot. Stands in for the city
 * until Phase 8 places banks on generated blocks.
 */
export const HEIST_MAP: GameMap = {
  id: 'heist',
  halfSize: HALF,
  boxes: [
    box('wall', 0, -HALF - 0.5, HALF * 2 + 2, WALL_HEIGHT, 1),
    box('wall', 0, HALF + 0.5, HALF * 2 + 2, WALL_HEIGHT, 1),
    box('wall', -HALF - 0.5, 0, 1, WALL_HEIGHT, HALF * 2 + 2),
    box('wall', HALF + 0.5, 0, 1, WALL_HEIGHT, HALF * 2 + 2),
    ...BANK_1_WORLD.boxes,
    box('cover', -10, 22, 6, 1.1, 0.4),
    box('cover', 12, 24, 0.4, 1.1, 5),
  ],
  spawns: ring(12, 48),
  anchors: BANK_1_WORLD.anchors,
  doors: BANK_1_WORLD.doors,
  vaults: BANK_1_WORLD.vaults,
};
