import type { GameMap } from './map';
import { HEIST_MAP } from './heistMap';
import { TEST_MAP } from './testMap';
import { cityMapById } from './city/cityMaps';

/** Fixed maps both sides can load by id (client `?map=`, server `MATCH_MAP`); generated cities come from `city[:seed]`. */
export const MAPS: Readonly<Record<string, GameMap>> = {
  [TEST_MAP.id]: TEST_MAP,
  [HEIST_MAP.id]: HEIST_MAP,
};

export const mapById = (id: string | null | undefined): GameMap | undefined =>
  id ? (MAPS[id] ?? cityMapById(id)) : undefined;
