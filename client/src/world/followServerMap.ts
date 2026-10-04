import { mapById } from '@heist/shared';

/**
 * The page query to reload with when the server plays a different map than
 * the one this page built (e.g. `?map=city` against `MATCH_MAP=city:class-7`):
 * the city is generated locally from the id, so both sides must use the
 * same one. Undefined when they already agree or the server's map is not
 * one a client can build (then there is nothing better to load).
 */
export function followServerMap(
  loadedId: string,
  serverId: string,
  search: string,
): string | undefined {
  if (loadedId === serverId || !mapById(serverId)) return undefined;
  const params = new URLSearchParams(search);
  params.set('map', serverId);
  return `?${params.toString()}`;
}
