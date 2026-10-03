import { h } from '../dom';
import ammo from './svg/ammo.svg?raw';
import cash from './svg/cash.svg?raw';
import healFull from './svg/heal-full.svg?raw';
import healMedium from './svg/heal-medium.svg?raw';
import healSmall from './svg/heal-small.svg?raw';
import pistol from './svg/pistol.svg?raw';
import rifle from './svg/rifle.svg?raw';
import shotgun from './svg/shotgun.svg?raw';
import smg from './svg/smg.svg?raw';
import sniper from './svg/sniper.svg?raw';
import vault from './svg/vault.svg?raw';

/**
 * Icons are from game-icons.net (CC BY 3.0; credits in docs/credits.md), bundled
 * as inline SVG so they take the text colour (currentColor) and need no requests.
 * Which icon a reward gets is presentation only, like labels.ts.
 */
const ICONS: Readonly<Record<string, string>> = {
  'heal:small': healSmall,
  'heal:medium': healMedium,
  'heal:full': healFull,
  'ammo:refill': ammo,
  'gun:pistol': pistol,
  'gun:smg': smg,
  'gun:shotgun': shotgun,
  'gun:rifle': rifle,
  'gun:sniper': sniper,
};

/** Every vault lock shares one icon; unknown rewards fall back to cash. */
function svgFor(rewardKey: string): string {
  if (rewardKey.startsWith('vault:')) return vault;
  return ICONS[rewardKey] ?? cash;
}

/**
 * Inline icon for a reward key. The SVG strings are bundled static assets,
 * never server or teacher text, so setting innerHTML here is safe.
 */
export function rewardIcon(rewardKey: string): HTMLElement {
  const el = h('span', { class: 'sqlp-icon', attrs: { 'aria-hidden': 'true' } });
  el.innerHTML = svgFor(rewardKey);
  return el;
}
