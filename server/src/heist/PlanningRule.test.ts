import { describe, expect, it } from 'vitest';
import { DEFAULT_HEIST_SETTINGS } from '@heist/shared';
import type { Player } from '../game/Player';
import { PlanningRule } from './PlanningRule';

const player = (accountId?: number) => ({ accountId }) as unknown as Player;

describe('PlanningRule', () => {
  it('handles brief:* and opens only between rounds, for signed-in players, when switched on', () => {
    let over = false;
    const rule = new PlanningRule(DEFAULT_HEIST_SETTINGS, () => over);
    expect(rule.handles('brief:plan')).toBe(true);
    expect(rule.handles('heal:small')).toBe(false);
    expect(rule.betweenRounds).toBe(true);
    expect(rule.check(player(1))).toBe('not_allowed');
    over = true;
    expect(rule.check(player(1))).toBeUndefined();
    expect(rule.check(player())).toBe('not_allowed');
    const off = new PlanningRule({ ...DEFAULT_HEIST_SETTINGS, planningBriefs: false }, () => true);
    expect(off.check(player(1))).toBe('not_allowed');
  });
});
