import { isCityMapId, mapById, TEST_MAP, type GameMap } from '@heist/shared';
import { makeBenchMap } from '../loadtest/benchMap';

/** `city` and `city:<seed>` are generated cities; the client must load the same id. */
export type MapName = 'sandbox' | 'bench' | 'heist' | `city${string}`;

/** The game's world unless MATCH_MAP says otherwise: the generated city. */
export const DEFAULT_MAP: MapName = 'city';

/** Maps a worker can be told to load by name (workers cannot be handed objects with methods). */
export function mapByName(name: MapName | undefined): GameMap {
  if (name === 'bench') return makeBenchMap();
  return mapById(name ?? DEFAULT_MAP) ?? mapById(DEFAULT_MAP) ?? TEST_MAP;
}

/** MATCH_MAP → map name; unknown or missing values get the city. */
export function parseMapName(value: string | undefined): MapName {
  if (value === 'bench' || value === 'heist' || value === 'sandbox') return value;
  if (value && isCityMapId(value)) return value as MapName;
  return DEFAULT_MAP;
}
