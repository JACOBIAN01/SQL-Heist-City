import { isCityMapId, mapById, TEST_MAP, type GameMap } from '@heist/shared';
import { makeBenchMap } from '../loadtest/benchMap';

/** `city` and `city:<seed>` are generated cities; the client must load the same id. */
export type MapName = 'sandbox' | 'bench' | 'heist' | `city${string}`;

/** Maps a worker can be told to load by name (workers cannot be handed objects with methods). */
export function mapByName(name: MapName | undefined): GameMap {
  return name === 'bench' ? makeBenchMap() : (mapById(name) ?? TEST_MAP);
}

export function parseMapName(value: string | undefined): MapName {
  if (value === 'bench' || value === 'heist') return value;
  if (value && isCityMapId(value)) return value as MapName;
  return 'sandbox';
}
