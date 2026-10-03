import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqlPanel, type PanelState } from './SqlPanel';

let host: HTMLElement;
let panel: SqlPanel;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  panel = new SqlPanel(host);
});
afterEach(() => {
  panel.destroy();
  host.remove();
});

const root = () => host.querySelector('.sqlp') as HTMLElement;
const bar = () => host.querySelector('.sqlp-bar') as HTMLElement;
const click = (label: string) =>
  (host.querySelector(`[aria-label="${label}"]`) as HTMLElement).click();

describe('SqlPanel', () => {
  it('starts closed with nothing visible', () => {
    expect(panel.state).toBe('closed');
    expect(root().hidden).toBe(true);
    expect(bar().hidden).toBe(true);
  });

  it('opens as a dialog and exposes slots for other modules', () => {
    panel.open();
    expect(root().hidden).toBe(false);
    expect(root().getAttribute('role')).toBe('dialog');
    expect(root().dataset.state).toBe('open');
    expect(root().contains(panel.slots.problem)).toBe(true);
    expect(root().contains(panel.slots.work)).toBe(true);
  });

  it('minimise swaps the panel for the slim bar, and Resume brings it back', () => {
    panel.open();
    click('Minimise');
    expect(panel.state).toBe('minimised');
    expect(root().hidden).toBe(true);
    expect(bar().hidden).toBe(false);
    (bar().querySelector('button') as HTMLElement).click();
    expect(panel.state).toBe('open');
    expect(bar().hidden).toBe(true);
  });

  it('close hides everything', () => {
    panel.open();
    click('Close');
    expect(panel.state).toBe('closed');
    expect(root().hidden).toBe(true);
    expect(bar().hidden).toBe(true);
  });

  it('only minimises from open and only restores from minimised', () => {
    panel.minimise();
    expect(panel.state).toBe('closed');
    panel.open();
    panel.restore();
    expect(panel.state).toBe('open');
  });

  it('notifies listeners of real transitions only (so the game can auto-crouch)', () => {
    const seen: [PanelState, PanelState][] = [];
    const off = panel.onStateChange((s, p) => seen.push([s, p]));
    panel.open();
    panel.open();
    panel.minimise();
    panel.close();
    off();
    panel.open();
    expect(seen).toEqual([
      ['open', 'closed'],
      ['minimised', 'open'],
      ['closed', 'minimised'],
    ]);
  });

  it('shows task name and time on the bar', () => {
    panel.setBarText('Heal +50', '02:10');
    expect(bar().textContent).toContain('Heal +50');
    expect(bar().textContent).toContain('02:10');
  });
});
