import type { ItemRecord } from '@heist/shared';

/** Who an attempt belongs to, as the match knows it. */
export interface AttemptWho {
  /** The match's key for the player (set for unsigned players too); used by the round review. */
  readonly playerKey?: string;
  readonly accountId?: number;
  readonly classId?: number;
  readonly round?: number;
  /** The class's pre/post assessment this attempt belongs to. */
  readonly assessment?: 'pre' | 'post';
}

/** The fine-grained things that happen to an issued question (docs/RCBSE.md §8). */
export type AttemptEventKind =
  | 'issued'
  | 'run'
  | 'submit_correct'
  | 'submit_wrong'
  | 'submit_error'
  | 'hint'
  | 'lockout'
  | 'switch'
  | 'expire'
  | 'abandon'
  | 'death'
  | 'leave'
  /** Passed with the cheat code. */
  | 'cheat';

export interface AttemptEvent {
  readonly at: number;
  readonly kind: AttemptEventKind;
  readonly challengeId: string;
  readonly who: AttemptWho;
  readonly questionId: number;
  readonly rewardKey: string;
  /** Kind-specific facts (seed, hint index, error kind, …). */
  readonly detail?: Readonly<Record<string, unknown>>;
}

// SOLID: D — Why: the challenge service reports what happened to an interface; recording to
// PostgreSQL, feeding the live profile and tests each plug in a sink, and grading never changes.
export interface AttemptSink {
  /** A fine-grained event. */
  event(event: AttemptEvent): void;
  /** A question ended: the whole story in one record. */
  item(item: ItemRecord, who: AttemptWho): void;
}

/** Several sinks as one. */
export class FanOutSink implements AttemptSink {
  constructor(private readonly sinks: readonly AttemptSink[]) {}

  event(event: AttemptEvent): void {
    for (const s of this.sinks) s.event(event);
  }

  item(item: ItemRecord, who: AttemptWho): void {
    for (const s of this.sinks) s.item(item, who);
  }
}

/** Keeps everything in memory (tests). */
export class MemorySink implements AttemptSink {
  readonly events: AttemptEvent[] = [];
  readonly items: { item: ItemRecord; who: AttemptWho }[] = [];

  event(event: AttemptEvent): void {
    this.events.push(event);
  }

  item(item: ItemRecord, who: AttemptWho): void {
    this.items.push({ item, who });
  }
}
