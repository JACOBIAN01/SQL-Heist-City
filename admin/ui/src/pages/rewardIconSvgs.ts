// The picker previews the very pictures the game bundles (game-icons.net, CC BY 3.0, docs/credits.md).
import ammo from '../../../../client/src/ui/icons/svg/ammo.svg?raw';
import cash from '../../../../client/src/ui/icons/svg/cash.svg?raw';
import healFull from '../../../../client/src/ui/icons/svg/heal-full.svg?raw';
import healMedium from '../../../../client/src/ui/icons/svg/heal-medium.svg?raw';
import healSmall from '../../../../client/src/ui/icons/svg/heal-small.svg?raw';
import lock from '../../../../client/src/ui/icons/svg/lock.svg?raw';
import plan from '../../../../client/src/ui/icons/svg/plan.svg?raw';
import pistol from '../../../../client/src/ui/icons/svg/pistol.svg?raw';
import rifle from '../../../../client/src/ui/icons/svg/rifle.svg?raw';
import shotgun from '../../../../client/src/ui/icons/svg/shotgun.svg?raw';
import smg from '../../../../client/src/ui/icons/svg/smg.svg?raw';
import sniper from '../../../../client/src/ui/icons/svg/sniper.svg?raw';
import vault from '../../../../client/src/ui/icons/svg/vault.svg?raw';

/** Bundled files only (never user text), so setting them as markup is safe. */
export const ICON_SVGS: Readonly<Record<string, string>> = {
  ammo,
  cash,
  lock,
  plan,
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
