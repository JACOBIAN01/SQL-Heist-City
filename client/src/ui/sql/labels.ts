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
  'brief:plan': 'Plan the next heist',
  'job:delivery': 'Delivery receipt',
  'job:race': 'Race stewards’ check',
  'job:intel': 'Recon report',
  'job:sabotage': 'Sabotage log',
  'job:data_theft': 'The stolen records',
  'job:escort': 'Escort handover',
};

/** Remaining time as m:ss (rounded up, never negative). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** How much a hint costs, in the units the server says (never decided here). */
export function hintCostText(cost: number, mode: 'fraction' | 'absolute'): string {
  if (cost <= 0) return 'free';
  return mode === 'fraction' ? `−${Math.round(cost * 100)}% of your cash` : `−$${cost}`;
}

const INSIDE_KEY = /^inside:bank-(\d+)$/;
const INTEL_KEY = /^intel:bank-(\d+)$/;
const VAULT_KEY = /^vault:bank-(\d+):lock-(\d+)$/;

export function rewardLabel(rewardKey: string): string {
  const known = LABELS[rewardKey];
  if (known) return known;
  if (INSIDE_KEY.test(rewardKey)) return 'The inside man’s query';
  const intel = INTEL_KEY.exec(rewardKey);
  if (intel) return `Intel on bank ${intel[1]}`;
  const vault = VAULT_KEY.exec(rewardKey);
  if (vault) return `Vault lock ${vault[2]} (bank ${vault[1]})`;
  return rewardKey;
}
