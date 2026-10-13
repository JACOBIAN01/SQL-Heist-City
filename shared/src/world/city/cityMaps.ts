import { DEFAULT_CITY_SETTINGS, citySettingsSchema, type CitySettings } from '../../config/city';
import { BANK_LAYOUTS, bankFootprint } from '../bank/banks';
import type { GameMap } from '../map';
import { compileCity } from './compileCity';
import { generateCity } from './generateCity';

/**
 * `city` uses the default seed; `city:<seed>` any other. Seeds are short and
 * URL-safe. Any generation setting that differs from the default follows as
 * `~name=value` (`city:autumn~blocks=6~banks=4`), so the id alone tells a
 * client how to build the very same city the server runs.
 */
const CITY_ID = /^city(?::([A-Za-z0-9_-]{1,64}))?((?:~[A-Za-z]+=[0-9.]+)*)$/;

/** The map id for a set of city settings (the inverse of what `cityMapById` reads). */
export function cityMapIdFor(settings: CitySettings): string {
  const base = settings.seed === DEFAULT_CITY_SETTINGS.seed ? 'city' : `city:${settings.seed}`;
  const changed = (Object.keys(DEFAULT_CITY_SETTINGS) as (keyof CitySettings)[])
    .filter((k) => k !== 'seed' && settings[k] !== DEFAULT_CITY_SETTINGS[k])
    .map((k) => `~${k}=${String(settings[k])}`);
  return base + changed.join('');
}

function settingsFromId(seed: string | undefined, overrides: string): CitySettings | undefined {
  const given: Record<string, string | number> = seed ? { seed } : {};
  for (const part of overrides.split('~').filter(Boolean)) {
    const [key, value] = part.split('=');
    if (!key || value === undefined || !(key in DEFAULT_CITY_SETTINGS) || key === 'seed')
      return undefined;
    given[key] = Number(value);
  }
  const parsed = citySettingsSchema.safeParse(given);
  return parsed.success ? parsed.data : undefined;
}

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
    const settings = settingsFromId(match[1], match[2] ?? '');
    if (!settings) return undefined;
    map = compileCity(id, generateCity(settings, bankFootprint), BANK_LAYOUTS);
    cache.set(id, map);
  }
  return map;
}

export const isCityMapId = (id: string): boolean => CITY_ID.test(id);
