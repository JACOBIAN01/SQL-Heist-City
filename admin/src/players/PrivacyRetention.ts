import type { PrivacySettings } from '@heist/shared';
import type { BriefStore } from '@heist/server/analytics/BriefStore';
import type { ClassRepository } from '@heist/server/classes/ClassRepository';
import type { PersonalDataRegistry } from '@heist/server/players/PersonalData';
import type { PlayerRepository } from '@heist/server/players/PlayerRepository';
import type { AdminEventBus } from '../events/AdminEvents';

const DAY_MS = 86_400_000;

export interface RetentionDeps {
  readonly players: PlayerRepository;
  readonly classes: ClassRepository;
  readonly briefs: BriefStore;
  readonly personalData: PersonalDataRegistry;
  readonly settings: () => Promise<PrivacySettings>;
  readonly events: AdminEventBus;
  readonly now?: () => number;
  readonly log?: (message: string, fields: Record<string, unknown>) => void;
}

export interface RetentionResult {
  readonly accounts: number;
  readonly classes: number;
  readonly briefs: number;
}

/**
 * Deletes what is past its time (Phase 21.4), once a day: student accounts nobody has used for
 * `inactiveAccountDays`, archived classes after `archivedClassDays`, and open briefs after
 * `briefDays`. A deleted account goes through the same path as "delete my account" (every
 * registered source of personal data), so nothing is left behind. The learning record is pruned
 * by its own job (docs/privacy.md). 0 days keeps for ever.
 *
 * Pattern: Template-less service over Registry — Why: what counts as "all of a person's data" is
 * decided by the registry in one place, so the clean-up never has its own idea of it.
 */
export class PrivacyRetention {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: RetentionDeps) {}

  /** One pass. At most `batch` accounts per pass, so a first run on an old database is gentle. */
  async run(batch = 200): Promise<RetentionResult> {
    const s = await this.deps.settings();
    const now = (this.deps.now ?? Date.now)();
    let accounts = 0;
    if (s.inactiveAccountDays > 0) {
      const stale = await this.deps.players.inactiveSince(
        new Date(now - s.inactiveAccountDays * DAY_MS),
        batch,
      );
      for (const player of stale) {
        await this.deps.personalData.eraseAll(player);
        accounts++;
      }
    }
    const classes =
      s.archivedClassDays > 0
        ? (
            await this.deps.classes.deleteArchivedBefore(
              new Date(now - s.archivedClassDays * DAY_MS),
            )
          ).length
        : 0;
    const briefs =
      s.briefDays > 0
        ? await this.deps.briefs.deleteBefore(new Date(now - s.briefDays * DAY_MS))
        : 0;
    const result = { accounts, classes, briefs };
    if (accounts + classes + briefs > 0) {
      this.deps.log?.('retention: deleted what was past its time', result);
      this.deps.events.publish({ type: 'retention_run', detail: { ...result } });
    }
    return result;
  }

  /** Runs now and then every `everyMs` (a day). The timer never keeps the process alive. */
  start(everyMs = DAY_MS, onError: (err: unknown) => void = () => {}): void {
    const tick = () => void this.run().catch(onError);
    tick();
    this.timer = setInterval(tick, everyMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
