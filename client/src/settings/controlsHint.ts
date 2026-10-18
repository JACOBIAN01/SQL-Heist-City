import { keyLabel, keysFor, type Action, type PlayerSettings } from '@heist/shared';
import type { MessageKey } from '../i18n/en';

const first = (s: PlayerSettings, action: Action): string => {
  const key = keysFor(s, action)[0];
  return key ? keyLabel(key) : '–';
};

const SHOWN: readonly Action[] = [
  'sprint',
  'crouch',
  'jump',
  'fire',
  'use',
  'tasks',
  'scoreboard',
  'aim',
  'map',
  'profile',
  'review',
  'mute',
  'settings',
];

/** The line shown before the game starts: the player's own keys, in their own language. */
export function controlsHint(
  settings: PlayerSettings,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  const move = (['forward', 'left', 'back', 'right'] as const).map((a) => first(settings, a));
  const guns = (['weapon1', 'weapon5'] as const).map((a) => first(settings, a)).join('–');
  const parts = [
    `${move.join('')} ${t('action.forward')}`,
    ...SHOWN.map((a) => `${first(settings, a)} ${t(`action.${a}` as MessageKey)}`),
    `${guns} ${t('game.guns')}`,
  ];
  return t('game.hint', { keys: parts.join(' · ') });
}
