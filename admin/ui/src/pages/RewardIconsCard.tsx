import { useEffect, useState } from 'react';
import { REWARD_ICON_IDS, REWARD_ICON_KEYS } from '@heist/shared';
import { useSaveSection, useSection } from '../api/config';
import { ErrorMessage } from '../components/ErrorMessage';
import { rewardLabel } from './rewardLabels';
import { ICON_SVGS } from './rewardIconSvgs';

/** Which picture each reward shows in the game's pop-up and weapon bar. */
export function RewardIconsCard({ editable }: { editable: boolean }) {
  const section = useSection('rewardIcons');
  const save = useSaveSection('rewardIcons');
  const [icons, setIcons] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (section.data) setIcons(section.data.current as Record<string, string>);
  }, [section.data]);

  if (!icons || !section.data) return <ErrorMessage error={section.error} />;
  const defaults = section.data.defaults as Record<string, string>;
  const current = section.data.current as Record<string, string>;
  const changed = Object.fromEntries(
    Object.entries(icons).filter(([key, id]) => current[key] !== id),
  );
  return (
    <div className="card stack">
      <h2>Reward icons</h2>
      <p className="muted">
        The picture shown for each reward. Players get a change at the start of the next round.
      </p>
      <div className="settings-grid">
        {REWARD_ICON_KEYS.map((key) => (
          <label key={key}>
            {rewardLabel(key)}
            <span className="row">
              <span
                className="icon-preview"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: ICON_SVGS[icons[key] ?? ''] ?? '' }}
              />
              <select
                aria-label={`icon ${key}`}
                disabled={!editable}
                value={icons[key]}
                onChange={(e) => setIcons({ ...icons, [key]: e.target.value })}
              >
                {REWARD_ICON_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </span>
            {icons[key] !== defaults[key] && <span className="muted">default {defaults[key]}</span>}
          </label>
        ))}
      </div>
      <ErrorMessage error={save.error} />
      {editable && (
        <div className="row">
          <button onClick={() => setIcons(defaults)}>Reset to defaults</button>
          <span className="spacer" />
          {save.isSuccess && <span className="notice">Saved ✓</span>}
          <button
            className="primary"
            disabled={save.isPending || Object.keys(changed).length === 0}
            onClick={() => save.mutate(changed)}
          >
            Save icons
          </button>
        </div>
      )}
    </div>
  );
}
