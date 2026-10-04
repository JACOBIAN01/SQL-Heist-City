import { mapById, TEST_MAP, type GameMap } from '@heist/shared';
import { makeBenchMap } from '../loadtest/benchMap';

export type MapName = 'sandbox' | 'bench' | 'heist';

/** Maps a worker can be told to load by name (workers cannot be handed objects with methods). */
export function mapByName(name: MapName | undefined): GameMap {
  return name === 'bench' ? makeBenchMap() : (mapById(name) ?? TEST_MAP);
}

export function parseMapName(value: string | undefined): MapName {
  return value === 'bench' || value === 'heist' ? value : 'sandbox';
}
