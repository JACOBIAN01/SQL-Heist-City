import { describe, expect, it } from 'vitest';
import type { JobMessage } from '@heist/shared';
import { I18n } from '../../i18n/I18n';
import { JobView } from './JobView';

const msg = (over: Partial<JobMessage> = {}): JobMessage => ({
  t: 'job',
  kind: 'delivery',
  status: 'active',
  targets: [{ x: 0, z: 0 }],
  index: 0,
  secondsLeft: 90,
  reward: 3000,
  ...over,
});

describe('JobView', () => {
  it('shows the job, counts the clock down between messages and hides when there is none', () => {
    const v = new JobView(new I18n('en'));
    expect(v.root.hidden).toBe(true);
    v.update(msg(), 0);
    expect(v.root.hidden).toBe(false);
    expect(v.root.textContent).toContain('1:30');
    expect(v.root.textContent).toContain('$3,000');
    v.frame(10_000);
    expect(v.root.textContent).toContain('1:20');
  });

  it('says which checkpoint a race is at, and what to do once it is run', () => {
    const v = new JobView(new I18n('en'));
    v.update(
      msg({
        kind: 'race',
        index: 1,
        targets: [
          { x: 0, z: 0 },
          { x: 1, z: 1 },
          { x: 2, z: 2 },
        ],
      }),
      0,
    );
    expect(v.root.textContent).toContain('checkpoint 2 of 3');
    v.update(msg({ status: 'claim' }), 0);
    expect(v.root.textContent).toContain('answer');
  });

  it('shows the result for a few seconds, then goes away', () => {
    const v = new JobView(new I18n('en'));
    v.update(msg({ status: 'done' }), 0);
    expect(v.root.textContent).toContain('+$3,000');
    v.frame(5000);
    expect(v.root.hidden).toBe(true);
  });
});
