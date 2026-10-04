import { citySettingsSchema } from '../../config/city';
import { BANK_LAYOUTS, bankFootprint } from '../bank/banks';
import type { GameMap } from '../map';
import { compileCity } from './compileCity';
import { generateCity } from './generateCity';

/** `city` uses the default seed; `city:<seed>` any other. Seeds are short and URL-safe. */
const CITY_ID = /^city(?::([A-Za-z0-9_-]{1,64}))?$/;

const cache = new Map<string, GameMap>();

/**
 * The city map for an id, built once per id and then shared.
 * Pattern: Flyweight — Why: generating a city is pure but not free, and the
 * collision grid is cached per map object; every caller with the same id
 * gets the very same map.
 */
export function cityMapById(id: string): GameMap | undefined {
  const match = CITY_ID.exec(id);
  if (!match) return undefined;
  let map = cache.get(id);
  if (!map) {
    const settings = citySettingsSchema.parse(match[1] ? { seed: match[1] } : {});
    map = compileCity(id, generateCity(settings, bankFootprint), BANK_LAYOUTS);
    cache.set(id, map);
  }
  return map;
}

export const isCityMapId = (id: string): boolean => CITY_ID.test(id);
