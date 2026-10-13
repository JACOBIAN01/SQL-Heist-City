import { DEFAULT_REWARD_ICONS, iconIdFor } from '@heist/shared';
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
import lock from './svg/lock.svg?raw';

/**
 * Icons are from game-icons.net (CC BY 3.0; credits in docs/credits.md), bundled
 * as inline SVG so they take the text colour (currentColor) and need no requests.
 * The admin chooses which one a reward shows (an id from this library, sent in
 * the `world` message); until the server says, the defaults apply.
 */
const LIBRARY: Readonly<Record<string, string>> = {
  ammo,
  cash,
  lock,
  pistol,
  rifle,
  shotgun,
  smg,
  sniper,
  vault,
  'heal-full': healFull,
  'heal-medium': healMedium,
  'heal-small': healSmall,
};

let chosen: Readonly<Record<string, string>> = DEFAULT_REWARD_ICONS;

/** Which picture each reward shows, as the server last said. */
export function setRewardIcons(icons: Readonly<Record<string, string>>): void {
  chosen = icons;
}

function svgFor(rewardKey: string): string {
  return LIBRARY[iconIdFor(chosen, rewardKey)] ?? cash;
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
