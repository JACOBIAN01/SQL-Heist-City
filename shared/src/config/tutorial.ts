import { z } from 'zod';
import type { HeistSettings } from './heist';

/** The tutorial's steps, in the order a new player meets them (docs/gameplay.md "Tutorial"). */
export const TUTORIAL_STEP_IDS = ['move', 'heal', 'gun', 'shoot', 'vault', 'loot', 'bank'] as const;
export type TutorialStepId = (typeof TUTORIAL_STEP_IDS)[number];

export interface TutorialStep {
  readonly id: TutorialStepId;
  readonly title: string;
  /** What to do, in a sentence or two: the player reads it while playing. */
  readonly text: string;
}

/** The words of each step. The server only says which step a player is on. */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'move',
    title: 'Move',
    text: 'Click the game to take the mouse. Walk with WASD, look with the mouse, and go to the glowing marker.',
  },
  {
    id: 'heal',
    title: 'Heal with SQL',
    text: 'You are hurt. Press Tab and pick a Heal task, write the query and Submit. The world keeps running while you type.',
  },
  {
    id: 'gun',
    title: 'Earn a gun',
    text: 'Guns are earned too. Press Tab and pick Gun: Pistol, then solve it.',
  },
  {
    id: 'shoot',
    title: 'Shoot',
    text: 'Go to the range. Hold the right mouse button to aim and click to fire until a target drops.',
  },
  {
    id: 'vault',
    title: 'Crack the vault',
    text: 'Enter the bank and climb the stairs at the back to the top floor. At the vault console press F and solve the lock.',
  },
  {
    id: 'loot',
    title: 'Grab the cash',
    text: 'The vault is open. Walk over a cash bag to pick it up. Carrying cash slows you down.',
  },
  {
    id: 'bank',
    title: 'Bank it',
    text: 'Carried cash drops when you die. Take it to the safehouse (S on the map), press F on the pad and stay unhurt until it is banked.',
  },
];

/** Tutorial numbers. Defaults only, like every other setting. */
export const tutorialSettingsSchema = z.object({
  /** Tutorials running at once (each is a private match on the game server); more players wait. */
  maxRooms: z.number().int().min(0).default(40),
  /** A tutorial closes after this long, finished or not. */
  maxMinutes: z.number().positive().default(30),
  /** Health the player starts with, so the first heal has something to do. */
  startHp: z.number().int().positive().default(35),
  /** How close (m) to the marker counts as "got there". */
  markerRadius: z.number().positive().default(2.5),
});

export type TutorialSettings = z.infer<typeof tutorialSettingsSchema>;
export const DEFAULT_TUTORIAL_SETTINGS: TutorialSettings = tutorialSettingsSchema.parse({});

/**
 * The heist rules the tutorial changes, applied over the match's own: one
 * lock, a small vault, no kill bonus (the targets would hand out cash), and a
 * round long enough that nobody is cut off mid-lesson.
 */
export const TUTORIAL_HEIST_OVERRIDES: Partial<HeistSettings> = {
  locksPerVault: 1,
  vaultLootByTier: { '1': 10_000 },
  killBonus: 0,
  roundMinutes: 120,
  overtimeSeconds: 3600,
};
