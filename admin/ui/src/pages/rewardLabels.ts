/** Names for the rewards, shown in the admin only. */
export const REWARD_LABELS: Record<string, string> = {
  'heal:small': 'Heal +20',
  'heal:medium': 'Heal +50',
  'heal:full': 'Full heal',
  'ammo:refill': 'Ammo refill',
  'gun:pistol': 'Pistol',
  'gun:smg': 'SMG',
  'gun:shotgun': 'Shotgun',
  'gun:rifle': 'Rifle',
  'gun:sniper': 'Sniper',
  vault: 'Vault locks',
};

export const rewardLabel = (key: string): string => REWARD_LABELS[key] ?? key;
