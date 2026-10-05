import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  MAX_JSON_BYTES,
  TUTORIAL_HEIST_OVERRIDES,
  TUTORIAL_MAP,
  type CombatSettings,
  type HeistSettings,
  type MatchSettings,
  type TutorialSettings,
  type TutorialTask,
} from '@heist/shared';
import type { IssueOptions } from '../challenges/ChallengeService';
import type { ChallengeGateway } from '../heist/ChallengeGateway';
import { GameLoop } from '../game/GameLoop';
import { serveGameConnection } from '../game/GameSocket';
import { CLOSE_FULL, CLOSE_ROUND, Match } from '../game/Match';
import { upgradeRouterFor } from '../net/UpgradeRouter';
import { TutorialCoach } from './TutorialCoach';

export interface TutorialDeps {
  /** Read for every new room, so admin edits apply to the next tutorial. */
  readonly settings: () => TutorialSettings;
  readonly match: MatchSettings;
  /** The game's heist rules; the tutorial's overrides go on top. */
  readonly heist: HeistSettings;
  readonly combat?: () => CombatSettings;
  readonly challenges: ChallengeGateway;
}

/**
 * One player's private tutorial: a match of one on the tutorial map, its
 * practice targets, and a coach. It ticks only while someone is in it.
 */
export class TutorialRoom {
  readonly match: Match;
  readonly coach: TutorialCoach;
  private readonly loop: GameLoop;

  constructor(deps: TutorialDeps, key: string) {
    const settings = deps.settings();
    this.match = new Match({
      map: TUTORIAL_MAP,
      // One player; the targets count as players too.
      settings: { ...deps.match, maxPlayers: 1 + (TUTORIAL_MAP.dummies?.length ?? 0) },
      heist: { ...deps.heist, ...TUTORIAL_HEIST_OVERRIDES },
      ...(deps.combat ? { combat: deps.combat() } : {}),
      challenges: deps.challenges,
      taskOptions: (rewardKey) => tutorialTaskOptions(settings, rewardKey),
      keyPrefix: `${key}:`,
      seed: key,
    });
    (TUTORIAL_MAP.dummies ?? []).forEach((spot, i) => this.match.addDummy(`Target ${i + 1}`, spot));
    const vaults = this.match.heist.vaults;
    this.coach = new TutorialCoach(
      {
        playerList: () => this.match.playerList(),
        sendJson: (player, message) => this.match.sendJson(player, message),
        anyVaultOpen: () => [...vaults.all()].some((v) => v.isOpen),
        events: this.match.heist.events,
      },
      settings,
    );
    this.loop = new GameLoop(1000 / deps.match.tickRate, () => this.step());
  }

  /** One tick: the match, then the coach looks at the result. */
  step(): void {
    this.match.step();
    this.coach.onTick();
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }
}

const TASKS: readonly TutorialTask[] = ['heal', 'gun', 'vault'];

/**
 * The tutorial asks the same question for each task, every run, with the
 * solution free: heal, gun and vault tasks get their configured question and
 * seed; anything else (ammo) is issued the normal way.
 */
export function tutorialTaskOptions(
  settings: TutorialSettings,
  rewardKey: string,
): IssueOptions | undefined {
  const task = TASKS.find((t) => rewardKey.startsWith(`${t}:`));
  if (!task) return undefined;
  return {
    fixed: { slug: settings.questions[task], seed: `${settings.seed}:${task}` },
    revealSolution: true,
  };
}

export interface TutorialSocket {
  /** Tutorials running now. */
  readonly rooms: number;
  close(): Promise<void>;
}

/**
 * `/ws/tutorial`: every connection gets a room of its own, speaking the same
 * protocol as the game socket. Rooms are capped (each one ticks) and closed
 * when their player leaves or their time is up.
 */
export function attachTutorialSocket(
  http: Server,
  deps: TutorialDeps,
  options: { readonly path?: string; readonly joinTimeoutMs?: number } = {},
): TutorialSocket {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_JSON_BYTES + 16 });
  upgradeRouterFor(http).route(options.path ?? '/ws/tutorial', wss);
  let open = 0;
  let made = 0;

  wss.on('connection', (socket: WebSocket) => {
    if (open >= deps.settings().maxRooms) {
      socket.close(CLOSE_FULL, 'Every tutorial is busy, try again in a minute');
      return;
    }
    open++;
    const room = new TutorialRoom(deps, `tutorial-${++made}`);
    room.start();
    const timeUp = setTimeout(
      () => socket.close(CLOSE_ROUND, 'Tutorial time is up'),
      deps.settings().maxMinutes * 60_000,
    );
    serveGameConnection(room.match, {
      ...(options.joinTimeoutMs !== undefined ? { joinTimeoutMs: options.joinTimeoutMs } : {}),
    })(socket, {
      onJoined: (player) => room.coach.onJoin(player),
      onClosed: () => {
        clearTimeout(timeUp);
        room.stop();
        open--;
      },
    });
  });

  return {
    get rooms() {
      return open;
    },
    close: () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}
