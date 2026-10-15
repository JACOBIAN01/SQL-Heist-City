import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AssessmentKind, AssessmentStore } from '../classes/AssessmentStore';
import type { GameAuth } from '../game/GameAuth';
import type { BucketLimit } from '@heist/shared';
import { messageLimit } from '../net/messageLimit';
import { upgradeRouterFor } from '../net/UpgradeRouter';
import type { ChallengeMessageHandler } from './ChallengeMessageHandler';

export interface AssessmentOptions {
  readonly path?: string;
  readonly auth?: GameAuth;
  readonly assessments: AssessmentStore;
  /** The slug of a question (assessments name questions by id). */
  readonly slugOf: (questionId: number) => string | undefined;
  /** Question ids this student has already answered in this assessment (one go per question). */
  readonly answered: (
    accountId: number,
    classId: number,
    kind: AssessmentKind,
  ) => Promise<Set<number>>;
  readonly now?: () => number;
  /** Messages per connection (default: RATE_LIMITS). */
  readonly messageLimit?: BucketLimit;
}

export interface AssessmentSocket {
  close(): Promise<void>;
}

const CLOSE_SIGN_IN = 4005;
const CLOSE_NOT_OPEN = 4007;

/**
 * A class's pre or post assessment (Phase 16.10): the same short fixed list of questions for
 * everyone, no hints, no easing, one go at each. The answers count in their own profile scope,
 * so the teacher sees the gain between pre and post.
 *
 * Connect with `?class=<id>&kind=pre|post&ticket=<class ticket>`. Then `{ t: 'assess_plan' }`
 * says how many questions there are and which are done, and `challenge_request` with
 * `rewardKey: 'assess:<n>'` asks for question n.
 */
export function attachAssessmentSocket(
  http: Server,
  handler: ChallengeMessageHandler,
  options: AssessmentOptions,
): AssessmentSocket {
  const now = options.now ?? Date.now;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  upgradeRouterFor(http).route(options.path ?? '/ws/assess', wss);

  wss.on('connection', (socket: WebSocket, request) => {
    void (async () => {
      const query = new URL(request.url ?? '/', 'http://x').searchParams;
      const classId = Number(query.get('class'));
      const kind =
        query.get('kind') === 'post' ? 'post' : query.get('kind') === 'pre' ? 'pre' : undefined;
      const verdict = options.auth?.admit(query.get('ticket') ?? '');
      // A class ticket proves the student is on this class's roster.
      if (!verdict?.ok || !verdict.identity || verdict.identity.classId !== classId || !kind) {
        socket.close(CLOSE_SIGN_IN, 'Sign in and join the class first');
        return;
      }
      const assessment = await options.assessments.get(classId, kind);
      if (!assessment || !assessment.open) {
        socket.close(CLOSE_NOT_OPEN, 'This assessment is not open');
        return;
      }
      const accountId = verdict.identity.playerId;
      const player = `assess-${kind}-${classId}-${accountId}`;
      // Questions started on this connection (saved answers reach the store a moment later).
      const started = new Set<number>();
      const send = (m: unknown) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
      };

      const allowed = messageLimit(socket, options.messageLimit, now);

      socket.on('message', (data, isBinary) => {
        if (!allowed()) return;
        void (async () => {
          let raw: Record<string, unknown>;
          try {
            if (isBinary) throw new Error('binary');
            raw = JSON.parse(data.toString()) as Record<string, unknown>;
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
          const done = await options.answered(accountId, classId, kind);
          for (const id of started) done.add(id);
          if (raw.t === 'assess_plan') {
            send({
              t: 'assess_plan',
              kind,
              total: assessment.questionIds.length,
              done: assessment.questionIds.map((id) => done.has(id)),
            });
            return;
          }
          if (raw.t === 'challenge_request') {
            const n = /^assess:(\d+)$/.exec(String(raw.rewardKey));
            const questionId = n ? assessment.questionIds[Number(n[1])] : undefined;
            const slug = questionId === undefined ? undefined : options.slugOf(questionId);
            const refuse = (reason: string) =>
              send({
                t: 'challenge',
                ref: raw.ref ?? null,
                now: now(),
                result: { ok: false, reason },
              });
            if (questionId === undefined || !slug) return refuse('unknown_reward');
            if (done.has(questionId)) return refuse('not_allowed'); // one go at each question
            started.add(questionId);
            send(
              await handler.handle(player, raw, {
                // Everyone gets the same question; the data is their own (seeded by who they are).
                fixed: { slug, seed: `assess:${classId}:${kind}:${accountId}:${questionId}` },
                noHints: true,
                who: { accountId, classId, assessment: kind },
              }),
            );
            return;
          }
          // Run, submit and abandon pass through; hints do not exist here.
          if (raw.t === 'challenge_hint') {
            send({
              t: 'challenge_hint',
              ref: raw.ref ?? null,
              now: now(),
              result: { ok: false, reason: 'no_such_hint' },
            });
            return;
          }
          send(await handler.handle(player, raw));
        })();
      });
      socket.on('close', () => handler.playerLeft(player));
      socket.on('error', () => socket.terminate());
      send({ t: 'assess_ready', kind, total: assessment.questionIds.length });
    })();
  });

  return {
    close: () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}
