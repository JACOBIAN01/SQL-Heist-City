import { box, type GameMap, type MapAnchor, type SpawnPoint } from './map';
import { compileBankWorld } from './bank/compileBank';
import { BANK_1 } from './bank/bank1';

const HALF = 60;
const WALL_HEIGHT = 4;
/** Where cash is banked on this lot; Phase 8 places them on city blocks. */
/** The hospital: where the dead wake up, behind the north wall of the lot, facing south into the map. */
const HOSPITAL: readonly SpawnPoint[] = [-6, -2, 2, 6].map((x) => ({ x, z: -54, yaw: Math.PI }));

const SAFEHOUSES: readonly { x: number; z: number }[] = [
  { x: -36, z: -36 },
  { x: 36, z: -36 },
  { x: 0, z: 42 },
];

const SAFEHOUSE_ANCHORS: MapAnchor[] = SAFEHOUSES.map((s, i) => ({
  id: `safehouse-${i + 1}`,
  kind: 'safehouse',
  x: s.x,
  y: 0,
  z: s.z,
  radius: 3,
  storey: 0,
}));

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
  unarmedStart: true,
  boxes: [
    box('wall', 0, -HALF - 0.5, HALF * 2 + 2, WALL_HEIGHT, 1),
    box('wall', 0, HALF + 0.5, HALF * 2 + 2, WALL_HEIGHT, 1),
    box('wall', -HALF - 0.5, 0, 1, WALL_HEIGHT, HALF * 2 + 2),
    box('wall', HALF + 0.5, 0, 1, WALL_HEIGHT, HALF * 2 + 2),
    ...BANK_1_WORLD.boxes,
    // A low wall behind each safehouse pad, so it reads as a place.
    ...SAFEHOUSES.map((s) => box('building', s.x, s.z - 3.6, 6, 2.4, 0.6)),
    // The hospital's back wall.
    box('building', 0, -58.2, 20, 4, 0.6),
    box('cover', -10, 22, 6, 1.1, 0.4),
    box('cover', 12, 24, 0.4, 1.1, 5),
  ],
  spawns: ring(12, 48),
  respawns: HOSPITAL,
  anchors: [...BANK_1_WORLD.anchors, ...SAFEHOUSE_ANCHORS],
  doors: BANK_1_WORLD.doors,
  vaults: BANK_1_WORLD.vaults,
};
