import {
  DEFAULT_ANALYTICS_SETTINGS,
  axisScores,
  remediation,
  type ProfileScopeView,
  type ProfileTotals,
} from '@heist/shared';

/** A scored view of some totals, as the server would send it (tests only). */
export function scopeViewOf(totals: ProfileTotals): ProfileScopeView {
  const rcsbe = axisScores(totals, 'rcsbe', DEFAULT_ANALYTICS_SETTINGS);
  const bloom = axisScores(totals, 'bloom', DEFAULT_ANALYTICS_SETTINGS);
  const focus = remediation(rcsbe);
  return {
    rcsbe,
    bloom,
    ...(focus ? { focus: { lens: 'rcsbe' as const, dimension: focus.dimension } } : {}),
  };
}
