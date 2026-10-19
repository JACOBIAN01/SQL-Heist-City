import type { Cosmetic, CosmeticSlot, MaskShape, ProgressionSettings } from '../config/progression';
import { COSMETIC_SLOTS } from '../config/progression';
import type { SkillView } from './skills';
import type { ProgressView } from './xp';

/** What a player has chosen to wear: a cosmetic id per slot, or nothing. */
export type LookChoice = Partial<Record<CosmeticSlot, string>>;

/** A choice resolved to what the renderer needs; this is what other players are sent. */
export interface LookView {
  readonly outfit?: number;
  readonly mask?: { readonly shape: MaskShape; readonly color: number };
  readonly paint?: number;
}

/** One cosmetic as the owner sees it. */
export interface CosmeticView {
  readonly id: string;
  readonly slot: CosmeticSlot;
  readonly name: string;
  readonly color: number;
  readonly shape?: MaskShape;
  readonly unlocked: boolean;
  /** For a locked one: what is missing (a rank name, a skill's name), for the client to word in the player's language. */
  readonly needs?: { readonly rank?: string; readonly skill?: string };
}

/** Every cosmetic with whether this player has earned it. */
export function wardrobe(
  progress: ProgressView,
  skills: readonly SkillView[],
  settings: ProgressionSettings,
): CosmeticView[] {
  const ranks = [...settings.ranks].sort((a, b) => a.minXp - b.minXp);
  return settings.cosmetics.map((c) => {
    const needs: { rank?: string; skill?: string } = {};
    if (c.unlock.rank) {
      const at = ranks.findIndex((r) => r.name === c.unlock.rank);
      // An unknown rank name never unlocks: a typo in the admin is visible, not a free item.
      if (at < 0 || progress.rankIndex < at) needs.rank = c.unlock.rank;
    }
    if (c.unlock.skill) {
      const node = skills.find((s) => s.id === c.unlock.skill);
      if (node?.state !== 'mastered') needs.skill = node?.name ?? c.unlock.skill;
    }
    return {
      id: c.id,
      slot: c.slot,
      name: c.name,
      color: c.color,
      ...(c.shape ? { shape: c.shape } : {}),
      unlocked: Object.keys(needs).length === 0,
      ...(Object.keys(needs).length ? { needs } : {}),
    };
  });
}

/** The choice with anything not unlocked (or unknown, or in the wrong slot) dropped. */
export function validChoice(choice: LookChoice, items: readonly CosmeticView[]): LookChoice {
  const out: LookChoice = {};
  for (const slot of COSMETIC_SLOTS) {
    const id = choice[slot];
    const found = id === undefined ? undefined : items.find((i) => i.id === id);
    if (found && found.slot === slot && found.unlocked) out[slot] = found.id;
  }
  return out;
}

/** A choice as the renderer needs it. */
export function lookOf(choice: LookChoice, catalog: readonly Cosmetic[]): LookView {
  const by = (slot: CosmeticSlot) => catalog.find((c) => c.id === choice[slot] && c.slot === slot);
  const outfit = by('outfit');
  const mask = by('mask');
  const paint = by('paint');
  return {
    ...(outfit ? { outfit: outfit.color } : {}),
    ...(mask ? { mask: { shape: mask.shape ?? 'bandana', color: mask.color } } : {}),
    ...(paint ? { paint: paint.color } : {}),
  };
}
