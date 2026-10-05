import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hud } from './Hud';

let host: HTMLElement;
let hud: Hud;
const q = (sel: string) => host.querySelector(sel) as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  hud = new Hud(host);
});
afterEach(() => {
  hud.destroy();
  host.remove();
  vi.useRealTimers();
});

describe('Hud', () => {
  it('shows health as a bar and a number, red when low', () => {
    hud.setHealth(80, 100);
    expect(q('.hud-health-fill').style.width).toBe('80%');
    expect(q('.hud-health span:last-child').textContent).toBe('80');
    expect(q('.hud-health-fill').dataset.low).toBe('false');
    hud.setHealth(20, 100);
    expect(q('.hud-health-fill').dataset.low).toBe('true');
    hud.setHealth(-5, 100);
    expect(q('.hud-health-fill').style.width).toBe('0%');
  });

  it('shows heist news in the feed, coloured by tone, for longer than a kill', () => {
    hud.addKill('A', 'B', false);
    hud.addEvent('ALARM · Corner Savings (bank 1): lock 1/3 cracked', 'alarm');
    const items = host.querySelectorAll('.hud-feed-item');
    expect(items).toHaveLength(2);
    expect((items[1] as HTMLElement).dataset.tone).toBe('alarm');
    vi.advanceTimersByTime(6000);
    expect(host.querySelectorAll('.hud-feed-item')).toHaveLength(1); // the kill is gone
    vi.advanceTimersByTime(3000);
    expect(host.querySelectorAll('.hud-feed-item')).toHaveLength(0);
  });

  it('puts a scope over the view only while scoped', () => {
    expect(q('.hud-scope').hidden).toBe(true);
    hud.setScoped(true);
    expect(q('.hud-scope').hidden).toBe(false);
    hud.setScoped(false);
    expect(q('.hud-scope').hidden).toBe(true);
  });

  it('shows and hides the spawn-protection note', () => {
    expect(q('.hud-shield').hidden).toBe(true);
    hud.setProtected(true);
    expect(q('.hud-shield').hidden).toBe(false);
  });

  it('flashes the hit marker briefly, red for headshots', () => {
    hud.showHitMarker(true);
    expect(q('.hud-hitmarker').classList.contains('show')).toBe(true);
    expect(q('.hud-hitmarker').dataset.head).toBe('true');
    vi.advanceTimersByTime(200);
    expect(q('.hud-hitmarker').classList.contains('show')).toBe(false);
  });

  it('flashes the screen on damage', () => {
    hud.flashDamage();
    expect(q('.hud-flash').classList.contains('show')).toBe(true);
    vi.advanceTimersByTime(100);
    expect(q('.hud-flash').classList.contains('show')).toBe(false);
  });

  it('keeps a short kill feed that expires, and never renders names as HTML', () => {
    hud.addKill('<img src=x onerror=alert(1)>', 'Ben', false);
    expect(host.querySelector('img')).toBeNull();
    expect(q('.hud-feed-item').textContent).toContain('<img');
    for (let i = 0; i < 8; i++) hud.addKill('A', 'B', true);
    expect(host.querySelectorAll('.hud-feed-item')).toHaveLength(5);
    vi.advanceTimersByTime(6000);
    expect(host.querySelectorAll('.hud-feed-item')).toHaveLength(0);
  });

  it('shows the death screen with a countdown', () => {
    expect(q('.hud-dead').hidden).toBe(true);
    hud.setDead(true, 4.2);
    expect(q('.hud-dead').hidden).toBe(false);
    expect(q('.hud-dead').textContent).toContain('Respawning in 5');
    hud.setDead(false);
    expect(q('.hud-dead').hidden).toBe(true);
  });
});

describe('Hud prompts', () => {
  it('shows the interaction prompt only while something is in reach', () => {
    expect(q('.hud-prompt').hidden).toBe(true);
    hud.setPrompt('F — Take the lift');
    expect(q('.hud-prompt').hidden).toBe(false);
    expect(q('.hud-prompt').textContent).toBe('F — Take the lift');
    hud.setPrompt(undefined);
    expect(q('.hud-prompt').hidden).toBe(true);
  });

  it('shows a toast and hides it after two seconds', () => {
    hud.toast('Floor 1');
    expect(q('.hud-toast').hidden).toBe(false);
    vi.advanceTimersByTime(2100);
    expect(q('.hud-toast').hidden).toBe(true);
  });
});

describe('Hud purse', () => {
  it('shows carried and banked cash with thousands separators', () => {
    hud.setPurse(12_500, 1_000_000);
    const text = q('.hud-purse').textContent;
    expect(text).toContain('$12,500');
    expect(text).toContain('$1,000,000');
  });
});

describe('Hud progress bar', () => {
  it('shows a label and a clamped fill, and hides again', () => {
    expect(q('.hud-progress').hidden).toBe(true);
    hud.setProgress({ label: 'Banking…', fraction: 0.25 });
    expect(q('.hud-progress').hidden).toBe(false);
    expect(q('.hud-progress').textContent).toContain('Banking…');
    expect(q('.hud-progress-fill').style.width).toBe('25%');
    hud.setProgress({ label: 'x', fraction: 3 });
    expect(q('.hud-progress-fill').style.width).toBe('100%');
    hud.setProgress(undefined);
    expect(q('.hud-progress').hidden).toBe(true);
  });
});
