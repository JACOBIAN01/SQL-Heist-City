import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { GameAuth } from '../game/GameAuth';
import { upgradeRouterFor } from '../net/UpgradeRouter';
import type { ChallengeMessageHandler } from './ChallengeMessageHandler';

export interface PracticeTopic {
  readonly topic: string;
  readonly title: string;
  /** Questions on this topic across the tiers. */
  readonly questions: number;
  /** Tiers that have a question on it. */
  readonly tiers: readonly number[];
}

export interface PracticeOptions {
  readonly path?: string;
  /** Who may practise: signed tickets. None: anyone (development). */
  readonly auth?: GameAuth;
  /** The topics a student can choose from. */
  readonly topics: () => readonly PracticeTopic[];
  readonly now?: () => number;
}

export interface PracticeSocket {
  close(): Promise<void>;
}

const CLOSE_SIGN_IN = 4005;
const TOPIC_MESSAGE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The solo drill (Phase 16.9): the SQL pop-up on its own, with no match, no combat and no
 * clock but the question's own time limit. A student picks a topic and a tier and gets questions
 * one after another; they count toward their profile like any other. Rewards do not exist here.
 *
 * Messages are the challenge messages (reward key `practice:<tier>`) plus
 * `{ t: 'practice_topics' }` and `{ t: 'practice_topic', topic }`.
 */
export function attachPracticeSocket(
  http: Server,
  handler: ChallengeMessageHandler,
  options: PracticeOptions,
): PracticeSocket {
  const now = options.now ?? Date.now;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  upgradeRouterFor(http).route(options.path ?? '/ws/practice', wss);
  let guests = 0;

  wss.on('connection', (socket: WebSocket, request) => {
    // The one-use ticket rides in the address (it expires in a minute and works once).
    const ticket = new URL(request.url ?? '/', 'http://x').searchParams.get('ticket') ?? '';
    const verdict = options.auth?.admit(ticket) ?? { ok: true as const };
    if (!verdict.ok) {
      socket.close(CLOSE_SIGN_IN, verdict.reason);
      return;
    }
    const accountId = verdict.identity?.playerId;
    const player = accountId === undefined ? `practice-guest-${++guests}` : `practice-${accountId}`;
    // The topic can also ride in the address, so the drill's own connection starts on it.
    const wanted = new URL(request.url ?? '/', 'http://x').searchParams.get('topic');
    let topic: string | undefined = wanted && TOPIC_MESSAGE.test(wanted) ? wanted : undefined;

    const send = (message: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    socket.on('message', (data, isBinary) => {
      void (async () => {
        let raw: { t?: unknown; topic?: unknown } & Record<string, unknown>;
        try {
          if (isBinary) throw new Error('binary');
          raw = JSON.parse(data.toString()) as typeof raw;
        } catch {
          send({
            t: 'challenge_error',
            ref: null,
            now: now(),
            code: 'bad_message',
            message: 'Messages must be JSON text',
          });
          return;
        }
        if (raw.t === 'practice_topics') {
          send({ t: 'practice_topics', topics: options.topics() });
          return;
        }
        if (raw.t === 'practice_topic') {
          topic =
            typeof raw.topic === 'string' && TOPIC_MESSAGE.test(raw.topic) ? raw.topic : undefined;
          send({ t: 'practice_topic', topic: topic ?? null });
          return;
        }
        // Only the practice reward keys exist here: a drill never hands out a gun, heal or vault lock.
        if (raw.t === 'challenge_request' && !/^practice:[1-5]$/.test(String(raw.rewardKey))) {
          send({
            t: 'challenge',
            ref: raw.ref ?? null,
            now: now(),
            result: { ok: false, reason: 'unknown_reward' },
          });
          return;
        }
        send(
          await handler.handle(player, raw, {
            who: { ...(accountId === undefined ? {} : { accountId }) },
            ...(topic ? { onlyTopics: [topic] } : {}),
          }),
        );
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
