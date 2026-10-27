import type { Rng } from '../../random/Rng';
import type { CityLayout } from './CityLayout';

/** Somewhere a cache may be hidden (Phase 30.2). */
export interface CacheSite {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly district: string;
}

/**
 * Places hidden caches: on the open ground of the city that nobody builds on. Every block has an
 * alley crossing in its middle, and plazas are open by definition, so both are free of colliders.
 * Chosen with `rng` (so each round hides them somewhere new), at least `minSpacing` m apart.
 */
export function cacheSites(
  city: CityLayout,
  rng: Rng,
  count: number,
  minSpacing = 60,
): CacheSite[] {
  const candidates: { x: number; z: number; district: string }[] = [];
  for (const b of city.blocks) {
    candidates.push({
      x: Math.round((b.inner.minX + b.inner.maxX) / 2),
      z: Math.round((b.inner.minZ + b.inner.maxZ) / 2),
      district: b.district,
    });
    for (const lot of b.lots)
      if (lot.use === 'plaza')
        candidates.push({
          x: Math.round((lot.rect.minX + lot.rect.maxX) / 2),
          z: Math.round((lot.rect.minZ + lot.rect.maxZ) / 2),
          district: b.district,
        });
  }
  const out: CacheSite[] = [];
  for (const c of rng.shuffle(candidates)) {
    if (out.length >= count) break;
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < minSpacing)) continue;
    out.push({ id: out.length + 1, ...c });
  }
  return out;
}

/**
 * Where the collectible data chips are (Phase 30.3): the same on every round and every server, so a
 * collection can be finished over many matches. Their ids are 1…count.
 */
export function collectibleSites(city: CityLayout, rng: Rng, count: number): CacheSite[] {
  return cacheSites(city, rng, count, 40);
}
