import { describe, expect, it } from 'vitest';
import { WeaponBar } from './WeaponBar';

const slots = (bar: WeaponBar) => [...bar.root.querySelectorAll<HTMLElement>('.hud-slot')];

describe('WeaponBar', () => {
  it('is hidden while you own nothing', () => {
    const bar = new WeaponBar();
    expect(bar.root.hidden).toBe(true);
    bar.setArms([], '');
    expect(bar.root.hidden).toBe(true);
  });

  it('shows only owned guns, numbered by key, with the one in hand lit', () => {
    const bar = new WeaponBar();
    bar.setArms(['pistol', 'rifle'], 'rifle');
    expect(bar.root.hidden).toBe(false);
    const visible = slots(bar).filter((s) => !s.hidden);
    expect(visible.map((s) => s.querySelector('.hud-slot-key')?.textContent)).toEqual(['1', '4']);
    expect(visible.map((s) => s.classList.contains('current'))).toEqual([false, true]);
    expect(bar.root.querySelector('.hud-weapon-name')?.textContent).toBe('Rifle');
  });

  it('shows rounds left and flags an empty magazine', () => {
    const bar = new WeaponBar();
    bar.setAmmo(7);
    expect(bar.root.querySelector('.hud-ammo')?.textContent).toBe('7');
    expect((bar.root.querySelector('.hud-ammo') as HTMLElement).dataset.empty).toBe('false');
    bar.setAmmo(0);
    expect((bar.root.querySelector('.hud-ammo') as HTMLElement).dataset.empty).toBe('true');
  });
});
