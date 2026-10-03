/**
 * Player-facing names for reward keys. Presentation only: amounts, tiers and
 * costs always come from the server, so none appear here.
 */
const LABELS: Readonly<Record<string, string>> = {
  'heal:small': 'Small heal',
  'heal:medium': 'Medium heal',
  'heal:full': 'Full heal',
  'ammo:refill': 'Ammo refill',
  'gun:pistol': 'Pistol',
  'gun:smg': 'SMG',
  'gun:shotgun': 'Shotgun',
  'gun:rifle': 'Rifle',
  'gun:sniper': 'Sniper',
};

/** How much a hint costs, in the units the server says (never decided here). */
export function hintCostText(cost: number, mode: 'fraction' | 'absolute'): string {
  if (cost <= 0) return 'free';
  return mode === 'fraction' ? `−${Math.round(cost * 100)}% of your cash` : `−$${cost}`;
}

const VAULT_KEY = /^vault:bank-(\d+):lock-(\d+)$/;

export function rewardLabel(rewardKey: string): string {
  const known = LABELS[rewardKey];
  if (known) return known;
  const vault = VAULT_KEY.exec(rewardKey);
  if (vault) return `Vault lock ${vault[2]} (bank ${vault[1]})`;
  return rewardKey;
}
