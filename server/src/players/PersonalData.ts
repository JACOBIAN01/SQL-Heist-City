import type { Player, PlayerRepository, PlayerSessions } from './PlayerRepository';

/**
 * One place that keeps personal data about a player: it can hand it over and
 * remove it.
 *
 * Pattern: Registry of strategies — Why: later phases (attempts, profiles,
 * class rosters) each store data about a player. Each registers itself here,
 * so "export my data" and "delete my account" stay complete without anyone
 * editing the account code (docs/identity.md, Phase 21).
 */
export interface PersonalDataSource {
  readonly name: string;
  export(player: Player): Promise<unknown>;
  /** Removes or anonymises everything this source holds about the player. */
  erase(player: Player): Promise<void>;
}

export class PersonalDataRegistry {
  private readonly sources: PersonalDataSource[] = [];

  register(source: PersonalDataSource): this {
    if (this.sources.some((s) => s.name === source.name))
      throw new Error(`personal data source "${source.name}" is already registered`);
    this.sources.push(source);
    return this;
  }

  get names(): string[] {
    return this.sources.map((s) => s.name);
  }

  async exportAll(player: Player): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const source of this.sources) out[source.name] = await source.export(player);
    return out;
  }

  /** Erases from every source. The player row itself goes last, so a failure leaves a retryable account. */
  async eraseAll(player: Player): Promise<void> {
    for (const source of this.sources) await source.erase(player);
  }
}

/** The account itself: profile and sign-in sessions. */
export function accountSource(
  players: PlayerRepository,
  sessions: PlayerSessions,
): PersonalDataSource {
  return {
    name: 'account',
    export: async (p) => ({
      id: p.id,
      email: p.email,
      displayName: p.displayName,
      schoolDomain: p.schoolDomain,
      googleSubject: p.googleSub,
      createdAt: p.createdAt,
      lastSeenAt: p.lastSeenAt,
    }),
    erase: async (p) => {
      await sessions.revokeAllFor(p.id);
      await players.remove(p.id);
    },
  };
}
