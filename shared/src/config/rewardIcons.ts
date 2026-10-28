import { z } from 'zod';

/**
 * The picture library a reward can use. The pictures themselves are bundled
 * with the game client; the admin only chooses an id, so an icon never
 * carries server- or teacher-written markup.
 */
export const REWARD_ICON_IDS = [
  'ammo',
  'cash',
  'heal-full',
  'heal-medium',
  'heal-small',
  'lock',
  'plan',
  'pistol',
  'rifle',
  'shotgun',
  'smg',
  'sniper',
  'vault',
] as const;
export type RewardIconId = (typeof REWARD_ICON_IDS)[number];

/** Rewards that get an icon. `vault` stands for every vault lock. */
export const REWARD_ICON_KEYS = [
  'heal:small',
  'heal:medium',
  'heal:full',
  'ammo:refill',
  'gun:pistol',
  'gun:smg',
  'gun:shotgun',
  'gun:rifle',
  'gun:sniper',
  'brief:plan',
  'duel:draw',
  'job:delivery',
  'job:race',
  'job:intel',
  'job:sabotage',
  'job:data_theft',
  'job:escort',
  'vault',
] as const;

/** Reward key → icon id. Defaults only: the admin's choices are stored over them. */
export const rewardIconsSchema = z.object(
  Object.fromEntries(REWARD_ICON_KEYS.map((k) => [k, z.enum(REWARD_ICON_IDS)])) as Record<
    (typeof REWARD_ICON_KEYS)[number],
    z.ZodEnum<{ [K in RewardIconId]: K }>
  >,
);

export type RewardIcons = z.infer<typeof rewardIconsSchema>;

export const DEFAULT_REWARD_ICONS: RewardIcons = {
  'heal:small': 'heal-small',
  'heal:medium': 'heal-medium',
  'heal:full': 'heal-full',
  'ammo:refill': 'ammo',
  'gun:pistol': 'pistol',
  'gun:smg': 'smg',
  'gun:shotgun': 'shotgun',
  'gun:rifle': 'rifle',
  'gun:sniper': 'sniper',
  'brief:plan': 'plan',
  'duel:draw': 'pistol',
  'job:delivery': 'plan',
  'job:race': 'lock',
  'job:intel': 'plan',
  'job:sabotage': 'lock',
  'job:data_theft': 'vault',
  'job:escort': 'pistol',
  vault: 'vault',
};

/** The icon id for a reward key (`vault:3:2` and the like use the shared `vault` entry); unknown rewards get cash. */
export function iconIdFor(icons: Readonly<Record<string, string>>, rewardKey: string): string {
  if (rewardKey.startsWith('vault:')) return icons['vault'] ?? 'vault';
  if (rewardKey.startsWith('inside:')) return icons['brief:plan'] ?? 'plan';
  if (rewardKey.startsWith('intel:')) return icons['brief:plan'] ?? 'plan';
  return icons[rewardKey] ?? 'cash';
}
