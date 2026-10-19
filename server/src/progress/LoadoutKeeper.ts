import {
  lookOf,
  validChoice,
  wardrobe,
  type CosmeticSlot,
  type CosmeticView,
  type LookChoice,
  type LookView,
  type ProgressView,
  type ProgressionSettings,
  type SkillView,
} from '@heist/shared';
import type { LoadoutStore } from './LoadoutStore';

export interface Wardrobe {
  readonly items: CosmeticView[];
  readonly choice: LookChoice;
}

/**
 * What each student wears (Phase 26.3). Every choice is checked against what the student has
 * earned *now*: a cosmetic can only be worn if it is unlocked, so the client never decides.
 * Nothing here is bought, rolled or random.
 */
export class LoadoutKeeper {
  constructor(
    private readonly store: LoadoutStore,
    private readonly settings: () => ProgressionSettings,
    private readonly progressOf: (accountId: number) => Promise<ProgressView>,
    private readonly skillsOf: (accountId: number) => readonly SkillView[],
  ) {}

  /** The student's wardrobe, with a stored choice that is no longer valid quietly dropped. */
  async wardrobeOf(accountId: number): Promise<Wardrobe> {
    const items = wardrobe(
      await this.progressOf(accountId),
      this.skillsOf(accountId),
      this.settings(),
    );
    const stored = await this.store.get(accountId);
    return { items, choice: validChoice(stored, items) };
  }

  /** Wear `id` in `slot` (null takes it off). A locked or wrong-slot id changes nothing. */
  async choose(accountId: number, slot: CosmeticSlot, id: string | null): Promise<Wardrobe> {
    const now = await this.wardrobeOf(accountId);
    const { [slot]: _worn, ...rest } = now.choice;
    const next: LookChoice = id === null ? rest : { ...rest, [slot]: id };
    const kept = validChoice(next, now.items);
    // An id that did not pass keeps what was worn.
    const choice = id !== null && kept[slot] !== id ? now.choice : kept;
    await this.store.put(accountId, choice);
    return { items: now.items, choice };
  }

  /** What other players see for this choice. */
  lookOf(choice: LookChoice): LookView {
    return lookOf(choice, this.settings().cosmetics);
  }
}
