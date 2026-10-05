import {
  TUTORIAL_STEPS,
  TUTORIAL_TARGETS,
  type JsonServerMessage,
  type TutorialSettings,
  type TutorialStepId,
} from '@heist/shared';
import type { Player } from '../game/Player';
import type { HeistEvents } from '../heist/HeistEvents';

/** What the coach watches in its room. */
export interface TutorialWorld {
  playerList(): Iterable<Player>;
  sendJson(player: Player, message: JsonServerMessage): void;
  /** Whether any vault in the room stands open. */
  anyVaultOpen(): boolean;
  readonly events: HeistEvents;
}

/** One player's lesson: which steps they have done so far. */
interface Lesson {
  readonly done: Set<TutorialStepId>;
  /** Heal tasks solved (an event, not something the player's state keeps). */
  healed: boolean;
  /** The step last sent, to send only changes. */
  sent: number;
}

/**
 * Whether a step is done, from the server's own state.
 * Pattern: Strategy (one check per step id) — Why: each step watches a
 * different thing (where you stand, what you own, what you banked); the
 * coach loop never changes when a step is added or reworded.
 */
type StepCheck = (player: Player, lesson: Lesson, world: TutorialWorld) => boolean;

const near = (player: Player, step: TutorialStepId, radius: number): boolean => {
  const t = TUTORIAL_TARGETS[step];
  return !!t && Math.hypot(player.body.x - t.x, player.body.z - t.z) <= radius;
};

/**
 * Walks a new player through the heist one step at a time, judging each
 * step by what the server knows happened (never by what the client says).
 * A step done early (a gun before the heal) still counts when its turn comes.
 */
export class TutorialCoach {
  private readonly lessons = new Map<number, Lesson>();
  private readonly checks: Readonly<Record<TutorialStepId, StepCheck>>;

  constructor(
    private readonly world: TutorialWorld,
    private readonly settings: TutorialSettings,
  ) {
    this.checks = {
      move: (p) => near(p, 'move', settings.markerRadius),
      heal: (_p, lesson) => lesson.healed,
      gun: (p) => p.arsenal.size > 0,
      shoot: (p) => p.kills > 0,
      vault: (_p, _l, w) => w.anyVaultOpen(),
      loot: (p) => p.cash > 0 || p.banked > 0,
      bank: (p) => p.banked > 0,
    };
    world.events.subscribe((event) => {
      if (event.type !== 'task_solved' || !event.rewardKey.startsWith('heal:')) return;
      const lesson = this.lessons.get(event.player.id);
      if (lesson) lesson.healed = true;
    });
  }

  /** A player arrived: hurt (so the heal step has a point) and on step one. */
  onJoin(player: Player): void {
    player.hp = Math.min(player.hp, this.settings.startHp);
    this.lessons.set(player.id, { done: new Set(), healed: false, sent: -1 });
    this.update(player);
  }

  /** Every tick: any newly done steps move the player on. */
  onTick(): void {
    for (const player of this.world.playerList()) this.update(player);
  }

  /** The step a player is on (TUTORIAL_STEPS.length once done), or -1 if they are not in a lesson. */
  stepOf(player: Player): number {
    const lesson = this.lessons.get(player.id);
    return lesson ? this.current(lesson) : -1;
  }

  private update(player: Player): void {
    const lesson = this.lessons.get(player.id);
    if (!lesson) return;
    for (const { id } of TUTORIAL_STEPS)
      if (!lesson.done.has(id) && this.checks[id](player, lesson, this.world)) lesson.done.add(id);
    const step = this.current(lesson);
    if (step === lesson.sent) return;
    lesson.sent = step;
    this.world.sendJson(player, { t: 'tutorial', step });
  }

  private current(lesson: Lesson): number {
    const i = TUTORIAL_STEPS.findIndex((s) => !lesson.done.has(s.id));
    return i < 0 ? TUTORIAL_STEPS.length : i;
  }
}
