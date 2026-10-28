import { z } from 'zod';
import { COUNTRY_THEME_IDS } from '../config/themes';

/**
 * A player's own settings (Phase 22): how they look around, hear, see and control the game.
 * Kept in the browser at once and, for a signed-in player, on their account so a new device or
 * another school computer plays the same way. Every value has a limit, because the server stores
 * what the browser sends.
 */

/** Everything a key can do. `Escape` always releases the mouse and closes panels: it is not on this list. */
export const ACTIONS = [
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'crouch',
  'sprint',
  'fire',
  'aim',
  'use',
  'tasks',
  'scoreboard',
  'map',
  'profile',
  'skills',
  'wardrobe',
  'contracts',
  'league',
  'squad',
  'collection',
  'story',
  'citydb',
  'leaderboard',
  'approach',
  'review',
  'mute',
  'radio',
  'settings',
  'weapon1',
  'weapon2',
  'weapon3',
  'weapon4',
  'weapon5',
] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABELS: Readonly<Record<Action, string>> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Move left',
  right: 'Move right',
  jump: 'Jump',
  crouch: 'Crouch',
  sprint: 'Sprint',
  fire: 'Fire',
  aim: 'Aim',
  use: 'Use (lift, vault, car)',
  tasks: 'Open the task list',
  scoreboard: 'Scoreboard (hold)',
  map: 'Full map',
  profile: 'My profile',
  skills: 'Skill tree',
  wardrobe: 'Wardrobe',
  contracts: 'Daily contracts',
  league: 'Class league',
  squad: 'Squad',
  collection: 'Data chip collection',
  story: 'Story journal',
  citydb: 'City database',
  leaderboard: 'Leanest-query leaderboard',
  approach: 'Stealth mode (toggle)',
  review: 'Review the round',
  mute: 'Mute sound',
  radio: 'Car radio (next station)',
  settings: 'Settings',
  weapon1: 'Gun 1',
  weapon2: 'Gun 2',
  weapon3: 'Gun 3',
  weapon4: 'Gun 4',
  weapon5: 'Gun 5',
};

/** `KeyboardEvent.code` values, or `Mouse0` (left), `Mouse1` (middle), `Mouse2` (right). */
export const DEFAULT_KEYS: Readonly<Record<Action, readonly string[]>> = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'KeyC'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  fire: ['Mouse0', 'KeyK'],
  aim: ['Mouse2'],
  use: ['KeyF'],
  tasks: ['Tab'],
  scoreboard: ['KeyB'],
  map: ['KeyM'],
  profile: ['KeyP'],
  skills: ['KeyJ'],
  wardrobe: ['KeyU'],
  contracts: ['KeyL'],
  league: ['KeyH'],
  squad: ['KeyG'],
  collection: ['KeyY'],
  story: ['KeyI'],
  citydb: ['KeyT'],
  leaderboard: ['KeyZ'],
  approach: ['KeyX'],
  review: ['KeyV'],
  mute: ['KeyN'],
  radio: ['KeyR'],
  settings: ['KeyO'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  weapon3: ['Digit3'],
  weapon4: ['Digit4'],
  weapon5: ['Digit5'],
};

/** Keys a player cannot give to an action: the browser or the game needs them. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  'Escape',
  'F5',
  'F11',
  'F12',
  'MetaLeft',
  'MetaRight',
  'ContextMenu',
]);

const keyCode = z.string().regex(/^[A-Za-z0-9]{2,20}$/);

export const PALETTES = [
  'default',
  'deuteranopia',
  'protanopia',
  'tritanopia',
  'high-contrast',
] as const;
export type Palette = (typeof PALETTES)[number];
export const LOCALES = ['en', 'hi'] as const;
export type Locale = (typeof LOCALES)[number];
export const GRAPHICS = ['auto', 'low', 'medium', 'high'] as const;
export type Graphics = (typeof GRAPHICS)[number];

export const playerSettingsSchema = z.object({
  look: z
    .object({
      /** Multiplier on mouse, stick and touch look speed. */
      sensitivity: z.number().min(0.2).max(3).default(1),
      invertY: z.boolean().default(false),
      /** Vertical field of view in degrees when not aiming. */
      fov: z.number().int().min(60).max(100).default(70),
    })
    .default({ sensitivity: 1, invertY: false, fov: 70 }),
  audio: z
    .object({
      master: z.number().min(0).max(1).default(1),
      effects: z.number().min(0).max(1).default(1),
      ambience: z.number().min(0).max(1).default(1),
    })
    .default({ master: 1, effects: 1, ambience: 1 }),
  graphics: z.object({ quality: z.enum(GRAPHICS).default('auto') }).default({ quality: 'auto' }),
  /** Only what differs from the defaults; an action missing here uses `DEFAULT_KEYS`. */
  keys: z
    .record(z.string().max(30), z.array(keyCode).max(4))
    // An action this version does not know (from a newer or older one) is dropped, not an error.
    .transform((all) => {
      const known = new Set<string>(ACTIONS);
      return Object.fromEntries(
        Object.entries(all).filter(([action]) => known.has(action)),
      ) as Partial<Record<Action, string[]>>;
    })
    .default({}),
  access: z
    .object({
      /** Multiplier on text size in the game's menus, HUD and pop-up. */
      textScale: z.number().min(0.85).max(1.6).default(1),
      palette: z.enum(PALETTES).default('default'),
      /** `system` follows the device's setting. */
      reducedMotion: z.enum(['system', 'on', 'off']).default('system'),
      /** Show a caption for sounds that matter (shots, alarms, cars). */
      subtitles: z.boolean().default(false),
    })
    .default({ textScale: 1, palette: 'default', reducedMotion: 'system', subtitles: false }),
  gamepad: z
    .object({
      deadzone: z.number().min(0.05).max(0.5).default(0.15),
      sensitivity: z.number().min(0.3).max(3).default(1),
    })
    .default({ deadzone: 0.15, sensitivity: 1 }),
  touch: z
    .object({
      /** `auto` shows the controls on devices that report touch. */
      controls: z.enum(['auto', 'on', 'off']).default('auto'),
      leftHanded: z.boolean().default(false),
    })
    .default({ controls: 'auto', leftHanded: false }),
  locale: z.enum(LOCALES).default('en'),
  /** The country's look for money, bank names and the cast (Phase 34.7). */
  theme: z.enum(COUNTRY_THEME_IDS).default('default'),
});

export type PlayerSettings = z.infer<typeof playerSettingsSchema>;
export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = playerSettingsSchema.parse({});

/** The keys an action uses now: the player's choice, or the default. */
export const keysFor = (settings: PlayerSettings, action: Action): readonly string[] =>
  settings.keys[action] ?? DEFAULT_KEYS[action];

/** Actions that share a key, which would make one of them unreachable or fire both. */
export function keyConflicts(settings: PlayerSettings): { key: string; actions: Action[] }[] {
  const by = new Map<string, Action[]>();
  for (const action of ACTIONS)
    for (const key of new Set(keysFor(settings, action)))
      by.set(key, [...(by.get(key) ?? []), action]);
  return [...by]
    .filter(([, actions]) => actions.length > 1)
    .map(([key, actions]) => ({ key, actions }));
}

/** What a key is called on screen. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Mouse0') return 'Left mouse';
  if (code === 'Mouse1') return 'Middle mouse';
  if (code === 'Mouse2') return 'Right mouse';
  return code
    .replace('Left', ' left')
    .replace('Right', ' right')
    .replace('Arrow', '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
}

/**
 * Reads whatever was stored (older versions, hand edits, another browser) into valid settings:
 * a value that is wrong is replaced by its default, the rest is kept.
 */
export function readPlayerSettings(raw: unknown): PlayerSettings {
  const whole = playerSettingsSchema.safeParse(raw);
  if (whole.success) return whole.data;
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PLAYER_SETTINGS;
  // Section by section, so one bad value does not throw away the rest.
  const shape = playerSettingsSchema.shape;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    const part = shape[key].safeParse((raw as Record<string, unknown>)[key]);
    out[key] = part.success ? part.data : DEFAULT_PLAYER_SETTINGS[key];
  }
  return out as PlayerSettings;
}
