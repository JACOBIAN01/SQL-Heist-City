import { describe, expect, it } from 'vitest';
import { axisAngle, pointAt, radarModel, type RadarAxis } from './radar';

const axes5: RadarAxis[] = ['R', 'C', 'S', 'B', 'E'].map((k) => ({ key: k, label: k }));

describe('radar geometry', () => {
  it('puts the first axis straight up and runs clockwise', () => {
    expect(axisAngle(0, 5)).toBeCloseTo(-Math.PI / 2);
    const m = radarModel(axes5, [], 200);
    expect(m.axes[0]?.end.x).toBeCloseTo(m.centre.x, 1);
    expect(m.axes[0]?.end.y).toBeLessThan(m.centre.y);
    expect(m.axes[1]?.end.x).toBeGreaterThan(m.centre.x); // clockwise: the second axis is on the right
  });

  it('spaces axes evenly, for five and for six', () => {
    for (const n of [5, 6]) {
      const gaps = Array.from({ length: n }, (_, i) => axisAngle((i + 1) % n, n) - axisAngle(i, n));
      for (const g of gaps.slice(0, -1)) expect(g).toBeCloseTo((2 * Math.PI) / n);
    }
  });

  it('scales 0–100 along the axis, clamped', () => {
    const c = { x: 100, y: 100 };
    expect(pointAt(c, 80, -Math.PI / 2, 0)).toEqual({ x: 100, y: 100 });
    expect(pointAt(c, 80, -Math.PI / 2, 50)).toEqual({ x: 100, y: 60 });
    expect(pointAt(c, 80, -Math.PI / 2, 100)).toEqual({ x: 100, y: 20 });
    expect(pointAt(c, 80, -Math.PI / 2, 250)).toEqual(pointAt(c, 80, -Math.PI / 2, 100));
    expect(pointAt(c, 80, -Math.PI / 2, -5)).toEqual({ x: 100, y: 100 });
  });

  it('draws four rings and a closed polygon per layer', () => {
    const m = radarModel(axes5, [{ id: 'me', kind: 'fill', values: [10, 20, 30, 40, 50] }]);
    expect(m.rings.map((r) => r.percent)).toEqual([25, 50, 75, 100]);
    expect(m.rings[3]?.path.startsWith('M')).toBe(true);
    expect(m.rings[3]?.path.endsWith('Z')).toBe(true);
    expect(m.layers[0]?.path.match(/L/g)).toHaveLength(4);
    expect(m.layers[0]?.thin).toEqual([]);
  });

  it('marks axes without evidence as thin, keeps the shape whole, and gives them no point', () => {
    const m = radarModel(axes5, [{ id: 'me', kind: 'fill', values: [null, 80, 60, null, 40] }]);
    const layer = m.layers[0];
    expect(layer?.thin).toEqual([0, 3]);
    expect(layer?.points[0]).toBeNull();
    expect(layer?.points[1]).not.toBeNull();
    expect(layer?.path.match(/L/g)).toHaveLength(4); // still five corners (thin ones at the centre)
  });

  it('carries comparison layers (outline, dashed) through unchanged', () => {
    const m = radarModel(axes5, [
      { id: 'me', kind: 'fill', values: [1, 2, 3, 4, 5] },
      { id: 'target', kind: 'outline', dashed: true, values: [10, 25, 40, 10, 15] },
    ]);
    expect(m.layers.map((l) => [l.id, l.kind, l.dashed])).toEqual([
      ['me', 'fill', false],
      ['target', 'outline', true],
    ]);
  });

  it('puts labels outside the chart and anchors them away from it', () => {
    const m = radarModel(axes5, [], 200);
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - m.centre.x, p.y - m.centre.y);
    for (const a of m.axes) expect(dist(a.labelAt)).toBeGreaterThan(dist(a.end));
    expect(m.axes[0]?.anchor).toBe('middle');
    expect(m.axes[1]?.anchor).toBe('start');
    expect(m.axes[4]?.anchor).toBe('end');
  });
});
