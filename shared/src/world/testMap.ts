import { box, type GameMap, type MapBox, type SpawnPoint } from './map';

const HALF = 60;
const WALL_HEIGHT = 4;

/** Steps of 0.25 m up to a 2 m platform: exercises step-up and jumping. */
function staircase(x: number, z: number): MapBox[] {
  const steps: MapBox[] = [];
  for (let i = 0; i < 8; i++) {
    steps.push(box('step', x, z + i * 0.8, 3, 0.25 * (i + 1), 0.8));
  }
  steps.push(box('step', x, z + 8 * 0.8 + 2, 3, 2, 4));
  return steps;
}

function ring(count: number, radius: number): SpawnPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      // Face the centre of the map.
      yaw: angle + Math.PI / 2,
    };
  });
}

/**
 * Phase 5 sandbox: a walled yard with blocks to hide behind, crates to jump
 * on and a staircase. Replaced by the generated city in Phase 8.
 */
export const TEST_MAP: GameMap = {
  id: 'sandbox',
  halfSize: HALF,
  boxes: [
    box('wall', 0, -HALF - 0.5, HALF * 2 + 2, WALL_HEIGHT, 1),
    box('wall', 0, HALF + 0.5, HALF * 2 + 2, WALL_HEIGHT, 1),
    box('wall', -HALF - 0.5, 0, 1, WALL_HEIGHT, HALF * 2 + 2),
    box('wall', HALF + 0.5, 0, 1, WALL_HEIGHT, HALF * 2 + 2),

    box('building', -28, -26, 18, 9, 14),
    box('building', 30, -22, 12, 6, 22),
    box('building', -22, 28, 24, 12, 10),

    box('crate', -4, -6, 1.2, 1.2, 1.2),
    box('crate', -2.4, -6, 1.2, 1.2, 1.2),
    box('crate', -3.2, -6, 1.2, 1.2, 1.2, 1.2),
    box('crate', 8, 5, 1, 1, 1),
    box('crate', 10, 8, 1.5, 1.5, 1.5),
    box('crate', 14, -3, 1, 0.6, 1),

    box('cover', 0, 14, 6, 1.1, 0.4),
    box('cover', -9, 10, 0.4, 1.1, 5),
    box('cover', 18, 16, 5, 1.1, 0.4),

    ...staircase(24, 6),
  ],
  spawns: ring(12, 50),
};
