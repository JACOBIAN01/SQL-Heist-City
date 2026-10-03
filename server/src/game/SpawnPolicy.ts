import type { GameMap, SpawnPoint } from '@heist/shared';

/**
 * Pattern: Strategy — Why: how spawns are chosen (safest, random, team-based)
 * changes with game modes; the match only asks for a point.
 */
export interface SpawnPolicy {
  pick(map: GameMap, others: readonly { x: number; z: number }[]): SpawnPoint;
}

/** Picks the spawn point furthest from every other player, so nobody spawns on top of an enemy. */
export class FarthestSpawnPolicy implements SpawnPolicy {
  pick(map: GameMap, others: readonly { x: number; z: number }[]): SpawnPoint {
    const fallback: SpawnPoint = { x: 0, z: 0, yaw: 0 };
    let best = map.spawns[0] ?? fallback;
    let bestDistance = -1;
    for (const spawn of map.spawns) {
      let nearest = Infinity;
      for (const o of others) nearest = Math.min(nearest, Math.hypot(o.x - spawn.x, o.z - spawn.z));
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = spawn;
      }
    }
    return best;
  }
}
