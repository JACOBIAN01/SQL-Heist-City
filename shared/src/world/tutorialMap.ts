import type { TutorialStepId } from '../config/tutorial';
import { box, type GameMap, type LootSpot, type MapAnchor, type SpawnPoint } from './map';
import { compileBankWorld } from './bank/compileBank';
import { BANK_1 } from './bank/bank1';

const HALF = 36;
const WALL_HEIGHT = 4;
/** You start at the front of the yard, facing the bank (yaw 0 looks toward −z). */
const START: SpawnPoint = { x: 0, z: 28, yaw: 0 };
const MARKER = { x: -6, y: 0, z: 18 };
/** The firing range on the west side: stand at the counter, the targets are 10 m beyond it. */
const RANGE = { x: -16, y: 0, z: 8 };
const TARGETS: readonly SpawnPoint[] = [2, 8, 14].map((z) => ({ x: -28, z, yaw: -Math.PI / 2 }));
const SAFEHOUSE: MapAnchor = {
  id: 'safehouse-1',
  kind: 'safehouse',
  x: 26,
  y: 0,
  z: 24,
  radius: 3,
  storey: 0,
};

const BANK = compileBankWorld(BANK_1, { x: 0, z: -8 });
const CONSOLE = BANK.anchors.find((a) => a.kind === 'vault_console');
const FIRST_BAG = BANK.vaults[0]?.loot[0];
if (!CONSOLE || !FIRST_BAG) throw new Error('tutorial bank has no vault');

/**
 * The tutorial yard: Bank 1 alone, a firing range with three targets and one
 * safehouse, so every part of the heist can be tried on a short walk.
 */
export const TUTORIAL_MAP: GameMap = {
  id: 'tutorial',
  halfSize: HALF,
  unarmedStart: true,
  boxes: [
    box('wall', 0, -HALF - 0.5, HALF * 2 + 2, WALL_HEIGHT, 1),
    box('wall', 0, HALF + 0.5, HALF * 2 + 2, WALL_HEIGHT, 1),
    box('wall', -HALF - 0.5, 0, 1, WALL_HEIGHT, HALF * 2 + 2),
    box('wall', HALF + 0.5, 0, 1, WALL_HEIGHT, HALF * 2 + 2),
    ...BANK.boxes,
    // The range counter: waist high, to shoot over.
    box('cover', RANGE.x - 3, RANGE.z, 0.6, 1.1, 12),
    // A wall behind the targets, and one behind the safehouse pad so it reads as a place.
    box('building', -31, 8, 0.6, 3, 18),
    box('building', SAFEHOUSE.x, SAFEHOUSE.z - 3.6, 6, 2.4, 0.6),
  ],
  spawns: [START],
  respawns: [START],
  dummies: TARGETS,
  anchors: [...BANK.anchors, SAFEHOUSE],
  doors: BANK.doors,
  vaults: BANK.vaults,
};

/** Where each step happens, for the marker (steps done anywhere, like healing, have none). */
export const TUTORIAL_TARGETS: Readonly<Partial<Record<TutorialStepId, LootSpot>>> = {
  move: MARKER,
  shoot: RANGE,
  vault: { x: CONSOLE.x, y: CONSOLE.y, z: CONSOLE.z },
  loot: FIRST_BAG,
  bank: { x: SAFEHOUSE.x, y: SAFEHOUSE.y, z: SAFEHOUSE.z },
};
