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
  host: string,
  lobbyPort: string,
  fetchLobby: (url: string) => Promise<LobbyReply> = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`lobby answered ${res.status}`);
    return (await res.json()) as LobbyReply;
  },
): Promise<string> {
  const fallback = `ws://${host}:${lobbyPort}/ws/game`;
  try {
    const lobby = await fetchLobby(`http://${host}:${lobbyPort}/lobby`);
    const match = lobby.open ?? lobby.matches[0];
    return match ? `ws://${host}:${match.port}/ws/game` : fallback;
  } catch {
    return fallback;
  }
}

/** The tutorial: a private room on the lobby server itself (no match to choose). */
export const tutorialUrl = (host: string, lobbyPort: string): string =>
  `ws://${host}:${lobbyPort}/ws/tutorial`;
