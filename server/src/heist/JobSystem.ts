import {
  JOB_KINDS,
  anchorInReach,
  type HeistSettings,
  type InteractResult,
  type JobKind,
  type JobMessage,
  type MapAnchor,
  type RejectReason,
  type SeededRng,
} from '@heist/shared';
import type { Player } from '../game/Player';
import type { InteractionHandler } from './InteractionService';
import { REACH_SLACK } from './InteractionService';
import type { MatchApi } from './MatchApi';
import { driveNpc, newNpcState, type NpcState } from './NpcDriver';
import type { TaskRule } from './TaskRule';

type Settings = HeistSettings['jobs'];
type Point = { x: number; z: number; y?: number };

interface Job {
  readonly kind: JobKind;
  readonly targets: Point[];
  /** The bank each target belongs to (recon, sabotage, data theft). */
  readonly banks: string[];
  index: number;
  readonly endsTick: number;
  status: 'active' | 'claim';
  /** Ticks spent at the target so far (sabotage, data theft). */
  dwell: number;
  /** The person being escorted. */
  vip?: Player;
  vipState?: NpcState;
}

/** What contracts need from the rest of the heist. */
export interface JobHooks {
  /** An intel point on a bank (recon). */
  grantIntel(player: Player, bank: string): void;
  /** The bank's guards cannot see anyone for a while (sabotage). */
  blind(bank: string, seconds: number): void;
  /** The police are told (data theft). */
  crime(player: Player): void;
  /** Somebody to escort, standing at `at`. */
  spawnVip(at: Point): Player | undefined;
  removeVip(vip: Player): void;
  /** A contract was finished and paid (the story listens). */
  done(player: Player, kind: JobKind): void;
}

const REWARD_KEY = new RegExp(`^job:(${JOB_KINDS.join('|')})$`);
const SEE_Y = 2.5;

/**
 * Contracts (Phases 30.6 and 31.2). A district's board offers a few kinds of job: deliveries and
 * street races, recon of other banks, sabotage of a bank's guards, data theft, and escorting a
 * person across the city. All end with a SQL question that must be answered to be paid. The
 * server owns the route, the clock and the pay: the client is only told where to go.
 * Pattern: Strategy (InteractionHandler and TaskRule) — Why: contracts plug into the interaction
 * and reward registries like every other usable spot and reward, with no change to either.
 */
export class JobSystem implements InteractionHandler, TaskRule {
  private readonly jobs = new Map<Player, Job>();

  constructor(
    private readonly match: MatchApi,
    private readonly settings: () => Settings,
    private readonly rng: SeededRng,
    private readonly pay: (player: Player, amount: number) => void,
    private readonly active: () => boolean,
    private readonly hooks: JobHooks,
  ) {}

  /** The player's job (for tests and the HUD). */
  jobOf(player: Player): Readonly<Job> | undefined {
    return this.jobs.get(player);
  }

  // --- the board (InteractionHandler) -------------------------------------------------------

  use(player: Player, anchor: MapAnchor): InteractResult {
    const s = this.settings();
    if (!s.enabled || !this.active()) return { action: 'denied', reason: 'not_available' };
    const kinds = s.boards[anchor.id.replace(/:board$/, '')];
    if (!kinds || kinds.length === 0) return { action: 'denied', reason: 'not_available' };
    const job = this.jobs.get(player);
    if (job?.status === 'claim')
      return { action: 'open_task', rewardKey: `job:${job.kind}`, target: anchor.id };
    if (job) return { action: 'denied', reason: 'busy' };
    return { action: 'open_board', board: anchor.id, kinds };
  }

  /** The player picks a contract from the board they stand at. */
  take(player: Player, boardId: string, kind: JobKind): void {
    const s = this.settings();
    const board = this.match.map.anchors?.find((a) => a.id === boardId && a.kind === 'job_board');
    const say = (text: string) => this.match.sendJson(player, { t: 'notice', text });
    if (!s.enabled || !this.active() || !board || !player.alive) return;
    const { x, y, z } = player.body;
    if (!anchorInReach({ ...board, radius: board.radius + REACH_SLACK }, x, y, z))
      return say('Step up to the board.');
    if (!s.boards[boardId.replace(/:board$/, '')]?.includes(kind))
      return say('That contract is not on this board.');
    if (this.jobs.has(player)) return say('Finish your current job first.');
    if (kind === 'race' && player.vehicleId === 0) return say('You need a car for a race.');
    const plan = this.plan(player, board, kind, s);
    if (!plan) return say('No contract is available right now.');
    const seconds = this.secondsOf(kind, s);
    const job: Job = {
      kind,
      targets: plan.targets,
      banks: plan.banks,
      index: 0,
      endsTick: this.match.tick + Math.ceil(seconds * this.match.tickRate),
      status: 'active',
      dwell: 0,
      ...(plan.vip ? { vip: plan.vip, vipState: newNpcState(plan.vip.body) } : {}),
    };
    this.jobs.set(player, job);
    this.send(player, job);
  }

  private secondsOf(kind: JobKind, s: Settings): number {
    switch (kind) {
      case 'delivery':
        return s.delivery.seconds;
      case 'race':
        return s.race.seconds;
      case 'intel':
        return s.intel.seconds;
      case 'sabotage':
        return s.sabotage.seconds;
      case 'data_theft':
        return s.dataTheft.seconds;
      case 'escort':
        return s.escort.seconds;
    }
  }

  private rewardOf(kind: JobKind, s: Settings): number {
    switch (kind) {
      case 'delivery':
        return s.delivery.reward;
      case 'race':
        return s.race.reward;
      case 'intel':
        return s.intel.reward;
      case 'sabotage':
        return s.sabotage.reward;
      case 'data_theft':
        return s.dataTheft.reward;
      case 'escort':
        return s.escort.reward;
    }
  }

  private radiusOf(kind: JobKind, s: Settings): number {
    switch (kind) {
      case 'delivery':
        return s.delivery.radius;
      case 'race':
        return s.race.radius;
      case 'intel':
        return s.intel.radius;
      case 'sabotage':
        return s.sabotage.radius;
      case 'data_theft':
        return s.dataTheft.radius;
      case 'escort':
        return s.escort.radius;
    }
  }

  /** Where a contract sends the player; undefined when the city has nowhere to send them. */
  private plan(
    player: Player,
    board: MapAnchor,
    kind: JobKind,
    s: Settings,
  ): { targets: Point[]; banks: string[]; vip?: Player } | undefined {
    const anchors = this.match.map.anchors ?? [];
    const far = (min: number) =>
      anchors.filter(
        (a) =>
          a.kind === 'job_board' &&
          a.id !== board.id &&
          Math.hypot(a.x - board.x, a.z - board.z) >= min,
      );
    switch (kind) {
      case 'delivery': {
        const drops = far(s.delivery.minDistance);
        const drop = drops.length > 0 ? this.rng.pick(drops) : undefined;
        return drop ? { targets: [{ x: drop.x, z: drop.z }], banks: [] } : undefined;
      }
      case 'race': {
        const targets = this.checkpoints(board, s);
        return targets.length > 0 ? { targets, banks: [] } : undefined;
      }
      case 'intel': {
        const terminals = anchors.filter((a) => a.kind === 'intel_terminal');
        const chosen = this.rng.shuffle(terminals).slice(0, s.intel.banks);
        const route = this.nearestFirst(chosen, board);
        return route.length > 0
          ? {
              targets: route.map((a) => ({ x: a.x, z: a.z })),
              banks: route.map((a) => a.bank ?? ''),
            }
          : undefined;
      }
      case 'sabotage':
      case 'data_theft': {
        const consoles = anchors.filter((a) => a.kind === 'vault_console');
        const console_ = consoles.length > 0 ? this.rng.pick(consoles) : undefined;
        return console_
          ? {
              targets: [{ x: console_.x, z: console_.z, y: console_.y }],
              banks: [console_.bank ?? ''],
            }
          : undefined;
      }
      case 'escort': {
        const drops = far(s.escort.minDistance);
        const drop = drops.length > 0 ? this.rng.pick(drops) : undefined;
        const vip = drop ? this.hooks.spawnVip({ x: board.x + 1.5, z: board.z }) : undefined;
        return drop && vip ? { targets: [{ x: drop.x, z: drop.z }], banks: [], vip } : undefined;
      }
    }
    void player;
  }

  private nearestFirst(items: MapAnchor[], from: MapAnchor): MapAnchor[] {
    const left = [...items];
    const route: MapAnchor[] = [];
    let here: { x: number; z: number } = from;
    while (left.length > 0) {
      left.sort(
        (a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z),
      );
      const next = left.shift() as MapAnchor;
      route.push(next);
      here = next;
    }
    return route;
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
      if (!player.alive || (job.vip && !job.vip.alive)) {
        this.end(player, 'failed');
        continue;
      }
      if (job.status === 'claim') continue;
      if (this.match.tick >= job.endsTick) {
        this.end(player, 'failed');
        continue;
      }
      if (job.vip && job.vipState) this.followMe(player, job, s);
      const target = job.targets[job.index];
      if (!target) continue;
      const radius = this.radiusOf(job.kind, s);
      const flat = Math.hypot(target.x - player.body.x, target.z - player.body.z);
      const sameFloor = target.y === undefined || Math.abs(target.y - player.body.y) <= SEE_Y;
      if (job.kind === 'race' && player.vehicleId === 0) continue; // a race is run in a car
      if (job.kind === 'sabotage' || job.kind === 'data_theft') {
        this.dwell(player, job, flat <= radius && sameFloor, s);
        continue;
      }
      if (flat > radius) continue;
      if (job.kind === 'escort' && !this.together(player, job, s)) continue;
      if (job.kind === 'intel') this.hooks.grantIntel(player, job.banks[job.index] ?? '');
      job.index++;
      if (job.index >= job.targets.length) job.status = 'claim';
      this.send(player, job);
    }
  }

  /** Sabotage and data theft: stay at the console until it is done; wandering off lets it slip back. */
  private dwell(player: Player, job: Job, there: boolean, s: Settings): void {
    const need = Math.ceil(
      (job.kind === 'sabotage' ? s.sabotage.dwellSeconds : s.dataTheft.dwellSeconds) *
        this.match.tickRate,
    );
    job.dwell = there ? job.dwell + 1 : Math.max(0, job.dwell - 2);
    if (job.dwell >= need) {
      job.status = 'claim';
      const bank = job.banks[0] ?? '';
      if (job.kind === 'sabotage') this.hooks.blind(bank, s.sabotage.blindSeconds);
      else this.hooks.crime(player);
      this.send(player, job);
    } else if (there && job.dwell % 5 === 0) this.send(player, job);
  }

  /** The escort walks after the player, keeping a few metres back. */
  private followMe(player: Player, job: Job, s: Settings): void {
    const vip = job.vip;
    const state = job.vipState;
    if (!vip || !state) return;
    const d = Math.hypot(player.body.x - vip.body.x, player.body.z - vip.body.z);
    driveNpc(
      this.match,
      vip,
      state,
      {
        ...(d > 3 ? { goal: { x: player.body.x, z: player.body.z } } : {}),
        speed: s.escort.speed,
        fire: false,
        aimErrorDegrees: 0,
        strafe: 0,
      },
      this.rng,
    );
  }

  private together(player: Player, job: Job, s: Settings): boolean {
    const vip = job.vip;
    return (
      vip !== undefined &&
      vip.alive &&
      Math.hypot(vip.body.x - player.body.x, vip.body.z - player.body.z) <= s.escort.together
    );
  }

  clear(player: Player): void {
    const job = this.jobs.get(player);
    if (job?.vip) this.hooks.removeVip(job.vip);
    this.jobs.delete(player);
  }

  /** The player dies (or otherwise loses the run): the job fails and they are told. */
  fail(player: Player): void {
    this.end(player, 'failed');
  }

  /** The person being escorted was killed. */
  vipDown(vip: Player): void {
    for (const [player, job] of this.jobs) if (job.vip === vip) this.end(player, 'failed');
  }

  /** A new round: every job is off. */
  reset(): void {
    for (const player of [...this.jobs.keys()]) this.end(player, 'failed');
  }

  private end(player: Player, status: 'done' | 'failed'): void {
    const job = this.jobs.get(player);
    this.jobs.delete(player);
    if (!job) return;
    if (job.vip) this.hooks.removeVip(job.vip);
    this.send(player, job, status);
  }

  private send(player: Player, job: Job, status?: 'done' | 'failed'): void {
    const s = this.settings();
    const need =
      (job.kind === 'sabotage' ? s.sabotage.dwellSeconds : s.dataTheft.dwellSeconds) *
      this.match.tickRate;
    const message: JobMessage = {
      t: 'job',
      kind: job.kind,
      status: status ?? job.status,
      targets: job.targets.map(({ x, z }) => ({ x, z })),
      index: job.index,
      secondsLeft: Math.max(0, (job.endsTick - this.match.tick) / this.match.tickRate),
      reward: this.rewardOf(job.kind, s),
      ...(job.kind === 'sabotage' || job.kind === 'data_theft'
        ? { dwell: Math.min(1, job.dwell / Math.max(1, need)) }
        : {}),
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
    this.pay(player, this.rewardOf(job.kind, this.settings()));
    this.end(player, 'done');
    this.hooks.done(player, job.kind);
  }
}
