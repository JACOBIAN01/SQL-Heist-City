import { describe, expect, it } from 'vitest';
import { HEIST_MAP, mapById } from '@heist/shared';
import { FullMapView, captionFor, fitMap, toScreen } from './FullMapView';
import { hospitalMarker, type Marker } from './minimapModel';

const bank = (opened: number, locks = 3): Marker => ({
  kind: 'bank',
  id: 'bank-3:vault',
  x: 0,
  z: 0,
  tier: 3,
  locks,
  opened,
  pinned: true,
});

describe('fitMap / toScreen', () => {
  it('fits the whole map, north up, as large as the box allows and centred', () => {
    const fit = fitMap(100, 800, 500, 20);
    // The short side (500) minus the margins is the map's side: 460 px for 200 m.
    expect(fit.scale).toBeCloseTo(2.3);
    const nw = toScreen(fit, -100, -100); // north-west corner
    expect(nw.x).toBeCloseTo(170);
    expect(nw.y).toBeCloseTo(20);
    const se = toScreen(fit, 100, 100); // south-east corner
    expect(se.x).toBeCloseTo(630);
    expect(se.y).toBeCloseTo(480);
    const mid = toScreen(fit, 0, 0); // the middle
    expect(mid.x).toBeCloseTo(400);
    expect(mid.y).toBeCloseTo(250);
  });

  it('puts north at the top: smaller z is higher on screen', () => {
    const fit = fitMap(50, 300, 300);
    expect(toScreen(fit, 0, -10).y).toBeLessThan(toScreen(fit, 0, 10).y);
  });
});

describe('captionFor', () => {
  it('names a bank with its lock progress, and says when it is open', () => {
    expect(captionFor(bank(1))).toBe('Metro Capital · 1/3 locks');
    expect(captionFor(bank(3))).toBe('Metro Capital · OPEN');
    expect(captionFor(bank(0, 0))).toBe('Metro Capital');
  });

  it('names the wanted and the hospital, and leaves the rest unlabelled', () => {
    expect(captionFor({ kind: 'wanted', id: 'w', x: 0, z: 0, name: 'Ana', pinned: true })).toBe(
      'Ana',
    );
    expect(captionFor({ kind: 'hospital', id: 'h', x: 0, z: 0, pinned: true })).toBe('Hospital');
    expect(captionFor({ kind: 'safehouse', id: 's', x: 0, z: 0, pinned: true })).toBeUndefined();
  });
});

describe('hospitalMarker', () => {
  it('marks the middle of the respawn beds, and nothing on maps without a hospital', () => {
    const m = hospitalMarker(HEIST_MAP);
    expect(m).toMatchObject({ kind: 'hospital', x: 0, z: -54 });
    expect(hospitalMarker({ ...HEIST_MAP, respawns: [] })).toBeUndefined();
    expect(hospitalMarker(mapById('city') ?? HEIST_MAP)).toBeDefined();
  });
});

describe('FullMapView', () => {
  it('opens and closes on toggle, hidden at first, and draws nothing while closed', () => {
    const host = document.createElement('div');
    const view = new FullMapView(host, HEIST_MAP);
    expect(view.isOpen).toBe(false);
    expect(view.root.hidden).toBe(true);
    view.toggle();
    expect(view.isOpen).toBe(true);
    expect(view.root.hidden).toBe(false);
    view.draw({ x: 0, z: 0, yaw: 0 }, [bank(1)], 0); // no canvas in tests: must not throw
    view.setOpen(false);
    expect(view.root.hidden).toBe(true);
    expect(host.textContent).toContain('safehouse');
  });
});
