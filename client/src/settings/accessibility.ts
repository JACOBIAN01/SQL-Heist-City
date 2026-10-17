import type { PlayerSettings } from '@heist/shared';
import { paletteVariables } from './palettes';

const VARIABLES = Object.keys(paletteVariables('default'));

/** Whether the device asks for less motion. */
export const systemReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Motion that is off, for the player's choice or the device's. */
export function reducedMotion(settings: PlayerSettings, system = systemReducedMotion()): boolean {
  const choice = settings.access.reducedMotion;
  return choice === 'on' || (choice === 'system' && system);
}

/**
 * Puts the player's accessibility choices on the page (Phase 22.3): text size (every size in the
 * CSS is in rem, so one number scales the menus, HUD and pop-up), a colour palette (the CSS reads
 * `--c-good` and the like, falling back to the original colours), and less motion.
 */
export function applyAccessibility(
  settings: PlayerSettings,
  root: HTMLElement = document.documentElement,
  system = systemReducedMotion(),
): void {
  root.style.fontSize = `${16 * settings.access.textScale}px`;
  const { palette } = settings.access;
  root.dataset.palette = palette;
  // The default palette sets nothing: the CSS fallbacks are its colours, exactly as designed.
  for (const name of VARIABLES) root.style.removeProperty(name);
  if (palette !== 'default')
    for (const [name, value] of Object.entries(paletteVariables(palette)))
      root.style.setProperty(name, value);
  root.dataset.reducedMotion = reducedMotion(settings, system) ? 'on' : 'off';
}
