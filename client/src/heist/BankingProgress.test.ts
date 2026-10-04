import { describe, expect, it, vi } from 'vitest';
import type { HudView } from '../ui/hud/Hud';
import { BankingProgress } from './BankingProgress';

function setup() {
  const hud = { setProgress: vi.fn(), toast: vi.fn() } as unknown as HudView;
  return { hud, progress: new BankingProgress(hud) };
}
const setProgress = (hud: HudView) => (hud.setProgress as unknown as ReturnType<typeof vi.fn>).mock;

describe('BankingProgress', () => {
  it('fills the bar over the time the server gave', () => {
    const { hud, progress } = setup();
    progress.handle({ t: 'banking', status: 'started', seconds: 4 }, 1000);
    progress.update(3000);
    expect(setProgress(hud).lastCall?.[0]).toEqual({ label: 'Banking…', fraction: 0.5 });
    progress.update(9000);
    expect((setProgress(hud).lastCall?.[0] as { fraction: number }).fraction).toBeGreaterThan(1);
  });

  it('does nothing when no banking is under way', () => {
    const { hud, progress } = setup();
    progress.update(5000);
    expect(setProgress(hud).calls).toHaveLength(0);
  });

  it('hides the bar and shows the amount when done', () => {
    const { hud, progress } = setup();
    progress.handle({ t: 'banking', status: 'started', seconds: 4 }, 0);
    progress.handle({ t: 'banking', status: 'done', amount: 12_500 }, 4000);
    expect(setProgress(hud).lastCall?.[0]).toBeUndefined();
    expect(hud.toast).toHaveBeenCalledWith('Banked $12,500');
    progress.update(5000);
    expect(setProgress(hud).calls.at(-1)?.[0]).toBeUndefined();
  });

  it('explains why banking stopped', () => {
    const { hud, progress } = setup();
    progress.handle({ t: 'banking', status: 'started', seconds: 4 }, 0);
    progress.handle({ t: 'banking', status: 'cancelled', reason: 'hurt' }, 1000);
    expect(hud.toast).toHaveBeenCalledWith('Banking interrupted: you were hit');
  });
});
