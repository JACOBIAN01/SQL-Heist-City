import type { ServerAddress } from './serverAddress';

export interface LobbyMatch {
  readonly port: number;
  readonly players: number;
  readonly maxPlayers: number;
}

export interface LobbyReply {
  readonly matches: readonly LobbyMatch[];
  readonly open?: LobbyMatch;
}

/**
 * Asks the lobby which match to join. Matches may run on other ports (one per
 * server thread), so the page cannot assume the address it was told. Any
 * failure falls back to the game socket on the lobby's own port.
 */
export async function chooseGameUrl(
  server: ServerAddress,
  fetchLobby: (url: string) => Promise<LobbyReply> = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`lobby answered ${res.status}`);
    return (await res.json()) as LobbyReply;
  },
): Promise<string> {
  const fallback = server.ws('/ws/game');
  try {
    const lobby = await fetchLobby(server.http('/lobby'));
    const match = lobby.open ?? lobby.matches[0];
    return match ? server.matchWs(match.port) : fallback;
  } catch {
    return fallback;
  }
}

/** The tutorial: a private room on the lobby server itself (no match to choose). */
export const tutorialUrl = (server: ServerAddress): string => server.ws('/ws/tutorial');
