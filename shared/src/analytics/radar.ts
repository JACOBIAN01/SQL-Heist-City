/**
 * Radar (spider) chart geometry, with no drawing: the client draws it with the
 * DOM and the admin with React, from the same numbers (docs/RCBSE.md §9).
 */

export interface RadarAxis {
  /** The letter or short key, e.g. "C". */
  readonly key: string;
  /** The full name, always shown with the key. */
  readonly label: string;
}

export interface RadarLayer {
  readonly id: string;
  /** One value per axis, 0–100; null where there is not enough evidence. */
  readonly values: readonly (number | null)[];
  /** Outlines are drawn for comparison layers (class average, target, all-time). */
  readonly kind: 'fill' | 'outline';
  readonly dashed?: boolean;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface RadarModel {
  readonly size: number;
  readonly centre: Point;
  readonly radius: number;
  readonly axes: readonly {
    readonly key: string;
    readonly label: string;
    /** The end of the axis line at 100%. */
    readonly end: Point;
    /** Where the label goes, and which way it hangs. */
    readonly labelAt: Point;
    readonly anchor: 'start' | 'middle' | 'end';
  }[];
  /** Concentric polygons at 25/50/75/100%. */
  readonly rings: readonly { readonly percent: number; readonly path: string }[];
  readonly layers: readonly {
    readonly id: string;
    readonly kind: 'fill' | 'outline';
    readonly dashed: boolean;
    /** Closed polygon; thin axes count as 0 so the shape stays whole. */
    readonly path: string;
    /** The point on each axis, or null when thin. */
    readonly points: readonly (Point | null)[];
    /** Axes with no value: draw a dashed marker and grey label ("not enough data"). */
    readonly thin: readonly number[];
  }[];
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));
const fmt = (n: number) => Math.round(n * 100) / 100;

/** Axis `i` of `n` points up and runs clockwise. */
export function axisAngle(i: number, n: number): number {
  return -Math.PI / 2 + (2 * Math.PI * i) / n;
}

export function pointAt(centre: Point, radius: number, angle: number, percent: number): Point {
  const r = (radius * clamp(percent)) / 100;
  return { x: fmt(centre.x + r * Math.cos(angle)), y: fmt(centre.y + r * Math.sin(angle)) };
}

const pathOf = (points: readonly Point[]) =>
  points.length === 0
    ? ''
    : `${points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')} Z`;

export function radarModel(
  axes: readonly RadarAxis[],
  layers: readonly RadarLayer[],
  size = 240,
  labelRoom = 0.2,
): RadarModel {
  const n = axes.length;
  const centre = { x: size / 2, y: size / 2 };
  const radius = (size / 2) * (1 - labelRoom);
  return {
    size,
    centre,
    radius,
    axes: axes.map((a, i) => {
      const angle = axisAngle(i, n);
      const cos = Math.cos(angle);
      return {
        key: a.key,
        label: a.label,
        end: pointAt(centre, radius, angle, 100),
        labelAt: pointAt(centre, (size / 2) * 0.93, angle, 100),
        anchor: Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end',
      };
    }),
    rings: [25, 50, 75, 100].map((percent) => ({
      percent,
      path: pathOf(axes.map((_, i) => pointAt(centre, radius, axisAngle(i, n), percent))),
    })),
    layers: layers.map((layer) => {
      const points = layer.values.map((v, i) =>
        v === null ? null : pointAt(centre, radius, axisAngle(i, n), v),
      );
      return {
        id: layer.id,
        kind: layer.kind,
        dashed: layer.dashed ?? false,
        path: pathOf(layer.values.map((v, i) => pointAt(centre, radius, axisAngle(i, n), v ?? 0))),
        points,
        thin: layer.values.flatMap((v, i) => (v === null ? [i] : [])),
      };
    }),
  };
}
