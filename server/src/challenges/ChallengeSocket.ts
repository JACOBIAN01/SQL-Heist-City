import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { BucketLimit } from '@heist/shared';
import { messageLimit } from '../net/messageLimit';
import { upgradeRouterFor } from '../net/UpgradeRouter';
import type { ChallengeMessageHandler } from './ChallengeMessageHandler';

export interface ChallengeSocketOptions {
  /** URL path that upgrades to a socket. */
  readonly path?: string;
  /** Largest message accepted, in bytes. Queries are short; this stops abuse early. */
  readonly maxPayload?: number;
  readonly now?: () => number;
  /** Messages per connection (default: RATE_LIMITS). */
  readonly messageLimit?: BucketLimit;
}

export interface ChallengeSocket {
  close(): Promise<void>;
}

/**
 * Demo/dev endpoint: one WebSocket per player carrying challenge messages.
 * The server assigns the player id — clients can never claim someone else's.
 * Phase 5 replaces this with the full game connection but keeps the handler.
 */
export function attachChallengeSocket(
  http: Server,
  handler: ChallengeMessageHandler,
  options: ChallengeSocketOptions = {},
): ChallengeSocket {
  const now = options.now ?? Date.now;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxPayload ?? 16 * 1024,
  });
  upgradeRouterFor(http).route(options.path ?? '/ws/challenge', wss);
  let nextPlayer = 1;

  wss.on('connection', (socket: WebSocket) => {
    const player = `guest-${nextPlayer++}`;
    const allowed = messageLimit(socket, options.messageLimit, now);

    socket.on('message', (data, isBinary) => {
      if (!allowed()) return;
      void (async () => {
        let raw: unknown;
        try {
          if (isBinary) throw new Error('binary frames are not accepted here');
          raw = JSON.parse(data.toString());
        } catch {
          send(socket, {
            t: 'challenge_error',
            ref: null,
            now: now(),
            code: 'bad_message',
            message: 'Messages must be JSON text',
          });
          return;
        }
        send(socket, await handler.handle(player, raw));
      })();
    });

    socket.on('close', () => handler.playerLeft(player));
    socket.on('error', () => socket.terminate());
  });

  return {
    close: () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}
