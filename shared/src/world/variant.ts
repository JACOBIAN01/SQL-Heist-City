import type { GameMap } from './map';

const variants = new WeakMap<GameMap, Map<string, GameMap>>();

/**
 * The map as it is right now: the fixed boxes plus the door of every vault
 * that is still closed. Variants are cached per set of closed doors, so
 * colliders are indexed once per state (a handful of states per match).
 * Pattern: Flyweight — Why: server and client both swap between a few
 * shared, immutable maps instead of mutating one, so the collision grid
 * (cached per map object) never goes stale.
 */
export function mapWithClosedDoors(map: GameMap, closedDoorIds: Iterable<string>): GameMap {
  const closed = new Set(closedDoorIds);
  const doors = (map.doors ?? []).filter((d) => closed.has(d.id));
  if (doors.length === 0) return map;
  const key = doors
    .map((d) => d.id)
    .sort()
    .join('|');
  let byKey = variants.get(map);
  if (!byKey) variants.set(map, (byKey = new Map()));
  let variant = byKey.get(key);
  if (!variant) {
    variant = { ...map, boxes: [...map.boxes, ...doors.map((d) => d.box)] };
    byKey.set(key, variant);
  }
  return variant;
}
