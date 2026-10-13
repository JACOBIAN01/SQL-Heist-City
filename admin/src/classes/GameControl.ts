import { INTERNAL_SECRET_HEADER } from '@heist/server/http/httpServer';

/** What a class room is doing, as the game server reports it. */
export interface RoomState {
  readonly state: 'waiting' | 'live';
  readonly port?: number;
  readonly players?: number;
  readonly maxPlayers?: number;
  readonly mapId?: string;
}

export type RoomCommand =
  | { readonly action: 'start' | 'stop' | 'refresh' | 'end_round' | 'next_round' }
  | { readonly action: 'kick'; readonly accountId: number }
  | { readonly action: 'rename'; readonly accountId: number; readonly name: string };

export type ControlResult =
  | { readonly ok: true; readonly status: RoomState }
  | { readonly ok: false; readonly reason: string };

// SOLID: D — Why: the class routes tell "the game" what the teacher did through this interface;
// production talks HTTP to the game server, tests record the calls.
export interface GameControl {
  status(classId: number): Promise<RoomState | undefined>;
  command(classId: number, command: RoomCommand): Promise<ControlResult>;
}

/** The game server's internal class API, with the shared secret. An unreachable server is reported, never thrown. */
export class HttpGameControl implements GameControl {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly doFetch: typeof fetch = (...a) => fetch(...a),
  ) {}

  async status(classId: number): Promise<RoomState | undefined> {
    try {
      const res = await this.doFetch(new URL(`/class/${classId}`, this.baseUrl));
      return res.ok ? ((await res.json()) as RoomState) : undefined;
    } catch {
      return undefined;
    }
  }

  async command(classId: number, command: RoomCommand): Promise<ControlResult> {
    try {
      const res = await this.doFetch(new URL(`/internal/class/${classId}`, this.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', [INTERNAL_SECRET_HEADER]: this.secret },
        body: JSON.stringify(command),
      });
      if (!res.ok) return { ok: false, reason: 'game_server_error' };
      return (await res.json()) as ControlResult;
    } catch {
      return { ok: false, reason: 'game_server_unreachable' };
    }
  }
}
