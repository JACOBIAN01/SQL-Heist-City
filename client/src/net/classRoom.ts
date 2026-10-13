/** Where a class's room is: not started yet, or live on a port. */
export type RoomStatus =
  | { readonly state: 'waiting' }
  | {
      readonly state: 'live';
      readonly port: number;
      readonly players: number;
      readonly maxPlayers: number;
      readonly mapId?: string;
    }
  | { readonly state: 'unavailable' };

/** Asks the game server about a class's room (public: the code was the secret). */
export async function roomStatus(
  host: string,
  lobbyPort: string,
  classId: number,
  doFetch: typeof fetch = (...a) => fetch(...a),
): Promise<RoomStatus> {
  try {
    const res = await doFetch(`http://${host}:${lobbyPort}/class/${classId}`);
    if (!res.ok) return { state: 'unavailable' };
    const body = (await res.json()) as {
      state: 'waiting' | 'live';
      port?: number;
      players?: number;
      maxPlayers?: number;
      mapId?: string;
    };
    if (body.state === 'live' && body.port)
      return {
        state: 'live',
        port: body.port,
        players: body.players ?? 0,
        maxPlayers: body.maxPlayers ?? 0,
        ...(body.mapId ? { mapId: body.mapId } : {}),
      };
    return { state: 'waiting' };
  } catch {
    return { state: 'unavailable' };
  }
}

export const classRoomUrl = (host: string, port: number): string => `ws://${host}:${port}/ws/game`;
