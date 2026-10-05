import type { Server } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  CodecError,
  MAX_JSON_BYTES,
  decodeClientMessage,
  encodeServerMessage,
} from '@heist/shared';
import { TokenBucket } from '../net/TokenBucket';
import { upgradeRouterFor } from '../net/UpgradeRouter';
import type { Match } from './Match';
import type { Player, PlayerConnection } from './Player';

export interface GameSocketOptions {
  readonly path?: string;
  /** Largest frame accepted. Input batches are ~82 bytes (their decoder rejects anything longer); JSON tasks may be larger. */
  readonly maxPayload?: number;
  /** Messages per second one client may send (input batches + pings). */
  readonly messagesPerSecond?: number;
  /** A client that does not send `join` within this many ms is dropped. */
  readonly joinTimeoutMs?: number;
  /** Unsent bytes allowed to queue for one client before it is dropped as too slow. */
  readonly maxBufferedBytes?: number;
}

export interface GameSocket {
  close(): Promise<void>;
}

const CLOSE_BAD_MESSAGE = 1008;
const CLOSE_TOO_SLOW = 1013;

/** Adapter: a `ws` socket seen as the match's `PlayerConnection`. */
function adapt(socket: WebSocket, maxBufferedBytes: number): PlayerConnection {
  return {
    send(bytes) {
      if (socket.readyState !== socket.OPEN) return;
      if (socket.bufferedAmount > maxBufferedBytes) {
        socket.close(CLOSE_TOO_SLOW, 'Connection too slow');
        return;
      }
      socket.send(bytes);
    },
    close: (code, reason) => socket.close(code, reason),
  };
}

/**
 * The game connection: binary frames in, binary frames out. Everything a
 * client sends is untrusted: size-capped, rate-limited, and strictly decoded.
 */
export function attachGameSocket(
  http: Server,
  match: Match,
  options: GameSocketOptions = {},
): GameSocket {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxPayload ?? MAX_JSON_BYTES + 16,
  });
  upgradeRouterFor(http).route(options.path ?? '/ws/game', wss);

  const serve = serveGameConnection(match, options);
  wss.on('connection', (socket: WebSocket) => serve(socket));

  return {
    close: () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}

/** What the owner of a connection may want to hear about it. */
export interface ConnectionHooks {
  /** The client joined: it is a player of the match now. */
  onJoined?(player: Player): void;
  /** The socket closed (after the player, if any, left the match). */
  onClosed?(): void;
}

/**
 * One client's conversation with a match: join first, then input, pings and
 * JSON. Shared by the public match and the private tutorial rooms.
 */
export function serveGameConnection(
  match: Match,
  options: GameSocketOptions = {},
): (socket: WebSocket, hooks?: ConnectionHooks) => void {
  const maxBuffered = options.maxBufferedBytes ?? 1_000_000;
  const rate = options.messagesPerSecond ?? 120;
  return (socket, hooks = {}) => {
    const connection = adapt(socket, maxBuffered);
    const bucket = new TokenBucket(rate, rate);
    let playerId: number | undefined;
    const joinTimer = setTimeout(
      () => socket.close(CLOSE_BAD_MESSAGE, 'Join expected'),
      options.joinTimeoutMs ?? 5000,
    );

    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (!isBinary || !bucket.take()) {
        socket.close(CLOSE_BAD_MESSAGE, 'Bad message');
        return;
      }
      let message;
      try {
        message = decodeClientMessage(toBytes(data));
      } catch (error) {
        if (!(error instanceof CodecError)) throw error;
        socket.close(CLOSE_BAD_MESSAGE, 'Bad message');
        return;
      }

      if (playerId === undefined) {
        if (message.t !== 'join') {
          socket.close(CLOSE_BAD_MESSAGE, 'Join first');
          return;
        }
        const result = match.join(message.protocol, message.name, connection);
        if (!result.ok) {
          socket.close(result.code, result.reason);
          return;
        }
        playerId = result.player.id;
        clearTimeout(joinTimer);
        hooks.onJoined?.(result.player);
        return;
      }

      switch (message.t) {
        case 'input':
          match.receiveInput(playerId, message.commands);
          break;
        case 'ping':
          match.touch(playerId);
          connection.send(
            encodeServerMessage({ t: 'pong', clientTime: message.clientTime, tick: match.tick }),
          );
          break;
        case 'json':
          match.receiveJson(playerId, message.text);
          break;
        case 'join':
          socket.close(CLOSE_BAD_MESSAGE, 'Already joined');
          break;
      }
    });

    socket.on('close', () => {
      clearTimeout(joinTimer);
      if (playerId !== undefined) match.leave(playerId);
      hooks.onClosed?.();
    });
    socket.on('error', () => socket.terminate());
  };
}

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return data;
}
