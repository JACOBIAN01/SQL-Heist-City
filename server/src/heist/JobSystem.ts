import type {
  HeistSettings,
  InteractResult,
  JobMessage,
  MapAnchor,
  RejectReason,
  SeededRng,
} from '@heist/shared';
import type { Player } from '../game/Player';
import type { InteractionHandler } from './InteractionService';
import type { MatchApi } from './MatchApi';
import type { TaskRule } from './TaskRule';

type Settings = HeistSettings['jobs'];
type Kind = 'delivery' | 'race';
type Point = { x: number; z: number };

interface Job {
  readonly kind: Kind;
  readonly targets: Point[];
  index: number;
  readonly endsTick: number;
  status: 'active' | 'claim';
}

const REWARD_KEY = /^job:(delivery|race)$/;

/**
 * Side jobs (Phase 30.6). A district's job board hands out a delivery or a street race; both end
 * with a SQL question that must be answered to be paid. The server owns the clock, the route and
 * the pay: the client is only told where to go.
 * Pattern: Strategy (InteractionHandler and TaskRule) — Why: jobs plug into the interaction and
 * reward registries like every other usable spot and reward, with no change to either.
 */
export class JobSystem implements InteractionHandler, TaskRule {
  private readonly jobs = new Map<Player, Job>();

  constructor(
    private readonly match: MatchApi,
    private readonly settings: () => Settings,
    private readonly rng: SeededRng,
    private readonly pay: (player: Player, amount: number) => void,
    private readonly active: () => boolean,
  ) {}

  /** The player's job (for tests and the HUD). */
  jobOf(player: Player): Readonly<Job> | undefined {
    return this.jobs.get(player);
  }

  // --- the board (InteractionHandler) -------------------------------------------------------

  use(player: Player, anchor: MapAnchor): InteractResult {
    const s = this.settings();
    if (!s.enabled || !this.active()) return { action: 'denied', reason: 'not_available' };
    const kind = s.boards[anchor.id.replace(/:board$/, '')];
    if (!kind) return { action: 'denied', reason: 'not_available' };
    const job = this.jobs.get(player);
    if (job?.status === 'claim')
      return { action: 'open_task', rewardKey: `job:${job.kind}`, target: anchor.id };
    if (job) return { action: 'denied', reason: 'busy' };
    if (kind === 'race' && player.vehicleId === 0) return { action: 'denied', reason: 'need_car' };
    const targets = kind === 'delivery' ? this.dropFor(anchor, s) : this.checkpoints(anchor, s);
    if (targets.length === 0) return { action: 'denied', reason: 'not_available' };
    const seconds = kind === 'delivery' ? s.delivery.seconds : s.race.seconds;
    const started: Job = {
      kind,
      targets,
      index: 0,
      endsTick: this.match.tick + Math.ceil(seconds * this.match.tickRate),
      status: 'active',
    };
    this.jobs.set(player, started);
    this.send(player, started);
    return { action: 'job_started', kind };
  }

  /** Another district's board, at least `minDistance` away. */
  private dropFor(from: MapAnchor, s: Settings): Point[] {
    const boards = (this.match.map.anchors ?? []).filter(
      (a) =>
        a.kind === 'job_board' &&
        a.id !== from.id &&
        Math.hypot(a.x - from.x, a.z - from.z) >= s.delivery.minDistance,
    );
    const drop = boards.length > 0 ? this.rng.pick(boards) : undefined;
    return drop ? [{ x: drop.x, z: drop.z }] : [];
  }

  /** Street junctions 50–250 m from the board, in a sensible order (always the nearest next). */
  private checkpoints(from: MapAnchor, s: Settings): Point[] {
    const city = this.match.map.city;
    if (!city) return [];
    const inner = (lines: readonly number[]) => lines.slice(1, -1);
    const junctions: Point[] = [];
    for (const x of inner(city.streetLinesX))
      for (const z of inner(city.streetLinesZ)) {
        const d = Math.hypot(x - from.x, z - from.z);
        if (d >= 50 && d <= 250) junctions.push({ x, z });
      }
    const chosen = this.rng.shuffle(junctions).slice(0, s.race.checkpoints);
    const route: Point[] = [];
    let here: Point = { x: from.x, z: from.z };
    while (chosen.length > 0) {
      chosen.sort(
        (a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z),
      );
      here = chosen.shift() as Point;
      route.push(here);
    }
    return route;
  }

  // --- the clock ------------------------------------------------------------------------------

  onTick(): void {
    const s = this.settings();
    for (const [player, job] of [...this.jobs]) {
      if (!player.alive) {
        this.end(player, 'failed');
        continue;
      }
      if (job.status === 'claim') continue;
      if (this.match.tick >= job.endsTick) {
        this.end(player, 'failed');
        continue;
      }
      const target = job.targets[job.index];
      if (!target) continue;
      const radius = job.kind === 'delivery' ? s.delivery.radius : s.race.radius;
      const driving = player.vehicleId !== 0;
      if (job.kind === 'race' && !driving) continue; // a race is run in a car
      if (Math.hypot(target.x - player.body.x, target.z - player.body.z) > radius) continue;
      job.index++;
      if (job.index >= job.targets.length) job.status = 'claim';
      this.send(player, job);
    }
  }

  /** Leaving takes the job away silently. */
  clear(player: Player): void {
    this.jobs.delete(player);
  }

  /** The player dies (or otherwise loses the run): the job fails and they are told. */
  fail(player: Player): void {
    this.end(player, 'failed');
  }

  /** A new round: every job is off. */
  reset(): void {
    for (const player of [...this.jobs.keys()]) this.end(player, 'failed');
  }

  private end(player: Player, status: 'done' | 'failed'): void {
    const job = this.jobs.get(player);
    this.jobs.delete(player);
    if (!job) return;
    this.send(player, job, status);
  }

  private send(player: Player, job: Job, status?: 'done' | 'failed'): void {
    const s = this.settings();
    const message: JobMessage = {
      t: 'job',
      kind: job.kind,
      status: status ?? job.status,
      targets: job.targets,
      index: job.index,
      secondsLeft: Math.max(0, (job.endsTick - this.match.tick) / this.match.tickRate),
      reward: job.kind === 'delivery' ? s.delivery.reward : s.race.reward,
    };
    this.match.sendJson(player, message);
  }

  // --- the question (TaskRule) ------------------------------------------------------------------

  handles(rewardKey: string): boolean {
    return REWARD_KEY.test(rewardKey);
  }

  check(player: Player, rewardKey: string): RejectReason | undefined {
    const job = this.jobs.get(player);
    const kind = REWARD_KEY.exec(rewardKey)?.[1];
    return job?.status === 'claim' && job.kind === kind ? undefined : 'not_allowed';
  }

  grant(player: Player, rewardKey: string): void {
    const job = this.jobs.get(player);
    if (!job || job.status !== 'claim' || !this.handles(rewardKey)) return;
    const s = this.settings();
    this.pay(player, job.kind === 'delivery' ? s.delivery.reward : s.race.reward);
    this.end(player, 'done');
  }
}
