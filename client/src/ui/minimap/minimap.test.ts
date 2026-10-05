import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEIST_MAP, box, mapById, type GameMap } from '@heist/shared';
import { MinimapView, drawStreetPlan } from './MinimapView';
import { markersFor, pinToRim, project, VaultAlerts } from './minimapModel';

describe('project', () => {
  it('puts what is ahead above the centre and what is to the right on the right', () => {
    // Facing −z (yaw 0): 10 m ahead is up, 10 m to the right (+x) is right.
    expect(project(0, -10, 0, 1)).toEqual({ x: 0, y: -10 });
    expect(project(10, 0, 0, 1).x).toBeCloseTo(10);
    // Facing −x (yaw π/2): −x is ahead, −z is to the right.
    const turned = project(-10, 0, Math.PI / 2, 2);
    expect(turned.x).toBeCloseTo(0);
    expect(turned.y).toBeCloseTo(-20);
    expect(project(0, -10, Math.PI / 2, 1).x).toBeCloseTo(10);
  });
});

describe('pinToRim', () => {
  it('keeps near points and pulls far ones onto the rim, keeping their direction', () => {
    expect(pinToRim({ x: 3, y: 4 }, 10)).toEqual({ x: 3, y: 4, pinned: false });
    const far = pinToRim({ x: 30, y: 40 }, 10);
    expect(far).toMatchObject({ pinned: true });
    expect(far.x).toBeCloseTo(6);
    expect(far.y).toBeCloseTo(8);
  });
});

describe('VaultAlerts', () => {
  it('flashes a vault for a while after a lock opens, but not for progress there on joining', () => {
    const alerts = new VaultAlerts(18);
    alerts.observe([{ id: 'v', tier: 1, locks: 3, opened: 1 }], 0);
    expect(alerts.isAlert('v', 0)).toBe(false);
    alerts.observe([{ id: 'v', tier: 1, locks: 3, opened: 2 }], 5);
    expect(alerts.isAlert('v', 10)).toBe(true);
    expect(alerts.isAlert('v', 24)).toBe(false);
  });
});

describe('markersFor', () => {
  it('marks every bank with its vault progress, every safehouse, and loose bags', () => {
    const city = mapById('city') as GameMap;
    const alerts = new VaultAlerts(18);
    const vaults = [{ id: 'bank-2:vault', tier: 2, locks: 3, opened: 1 }];
    const markers = markersFor(city, vaults, [{ id: 7, x: 1, z: 2 }], alerts, 0);
    const banks = markers.filter((m) => m.kind === 'bank');
    expect(banks).toHaveLength(5);
    expect(banks.find((b) => b.id === 'bank-2:vault')).toMatchObject({
      tier: 2,
      locks: 3,
      opened: 1,
      pinned: true,
    });
    expect(markers.filter((m) => m.kind === 'safehouse')).toHaveLength(3);
    expect(markers.find((m) => m.kind === 'bag')).toMatchObject({ x: 1, z: 2, pinned: false });
  });
});

/** A 2D context that only records what was asked of it. */
function recordingContext() {
  const calls: { name: string; args: unknown[] }[] = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (_t, name: string) =>
        (...args: unknown[]) =>
          calls.push({ name, args }),
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('drawStreetPlan', () => {
  it('fills the streets, then sidewalks, then building footprints', () => {
    const map: GameMap = {
      id: 'm',
      halfSize: 50,
      spawns: [],
      boxes: [
        box('kerb', 0, 0, 10, 0.15, 10),
        box('building', 20, 0, 8, 9, 8),
        box('crate', -20, 0, 1, 1, 1),
      ],
    };
    const { ctx, calls } = recordingContext();
    drawStreetPlan(ctx, map, 2);
    const rects = calls.filter((c) => c.name === 'fillRect').map((c) => c.args);
    expect(rects[0]).toEqual([0, 0, 200, 200]); // the streets
    expect(rects[1]).toEqual([90, 90, 20, 20]); // the sidewalk
    expect(rects[2]).toEqual([132, 92, 16, 16]); // the building; the 1 m crate is not on the plan
    expect(rects).toHaveLength(3);
  });
});

describe('MinimapView', () => {
  afterEach(() => vi.restoreAllMocks());

  it('draws the plan turned with the player, the markers and the player arrow', () => {
    const { ctx, calls } = recordingContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    const host = document.createElement('div');
    const view = new MinimapView(host, HEIST_MAP);
    expect(host.querySelector('canvas.hud-minimap')).not.toBeNull();
    calls.length = 0;
    const alerts = new VaultAlerts(18);
    alerts.observe([{ id: 'bank-1:vault', tier: 1, locks: 3, opened: 0 }], 0);
    alerts.observe([{ id: 'bank-1:vault', tier: 1, locks: 3, opened: 1 }], 1);
    const markers = markersFor(
      HEIST_MAP,
      [{ id: 'bank-1:vault', tier: 1, locks: 3, opened: 1 }],
      [],
      alerts,
      2,
    );
    view.draw({ x: 0, z: 30, yaw: 0.5 }, markers, 2);
    const names = calls.map((c) => c.name);
    expect(calls.find((c) => c.name === 'rotate')?.args).toEqual([0.5]);
    expect(names).toContain('drawImage');
    expect(calls.filter((c) => c.name === 'fillText').map((c) => c.args[0])).toEqual(
      expect.arrayContaining(['1', 'S', 'N']),
    );
    expect(names.filter((n) => n === 'stroke').length).toBeGreaterThanOrEqual(2); // progress + alarm
  });

  it('stays quiet where there is no canvas support', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const view = new MinimapView(document.createElement('div'), HEIST_MAP);
    expect(() => view.draw({ x: 0, z: 0, yaw: 0 }, [], 0)).not.toThrow();
  });
});
