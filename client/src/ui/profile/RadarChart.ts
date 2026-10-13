import type { RadarModel } from '@heist/shared';

const NS = 'http://www.w3.org/2000/svg';
/** Okabe–Ito: distinguishable with every common kind of colour blindness. Comparison layers also differ by dash. */
export const RADAR_COLOURS = {
  fill: '#0072b2',
  outline: '#e69f00',
  thin: '#8a93a6',
  grid: '#4a5368',
};

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  text?: string,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

export interface RadarDrawOptions {
  /** Axis keys that just moved: their label and point pulse. */
  readonly pulse?: readonly string[];
  /** A name for screen readers. */
  readonly title: string;
}

/**
 * Draws a radar from its model: rings, axes, one shape per layer, and every
 * label spelled out. Thin axes get a dashed grey spoke and "not enough data".
 * Text is set as text (never markup).
 */
export function drawRadar(model: RadarModel, options: RadarDrawOptions): SVGSVGElement {
  const root = svg('svg', {
    viewBox: `0 0 ${model.size} ${model.size}`,
    class: 'radar',
    role: 'img',
    'aria-label': options.title,
  });
  root.appendChild(svg('title', {}, options.title));
  for (const ring of model.rings)
    root.appendChild(
      svg('path', { d: ring.path, fill: 'none', stroke: RADAR_COLOURS.grid, 'stroke-width': 0.6 }),
    );
  for (const axis of model.axes)
    root.appendChild(
      svg('line', {
        x1: model.centre.x,
        y1: model.centre.y,
        x2: axis.end.x,
        y2: axis.end.y,
        stroke: RADAR_COLOURS.grid,
        'stroke-width': 0.6,
      }),
    );
  const thinEverywhere = new Set<number>();
  model.layers.forEach((layer, li) => {
    const colour = layer.kind === 'fill' ? RADAR_COLOURS.fill : RADAR_COLOURS.outline;
    const dash = layer.dashed || layer.kind === 'outline' ? '5 3' : undefined;
    root.appendChild(
      svg('path', {
        d: layer.path,
        fill: layer.kind === 'fill' ? colour : 'none',
        'fill-opacity': layer.kind === 'fill' ? 0.3 : 0,
        stroke: colour,
        'stroke-width': 2,
        ...(dash ? { 'stroke-dasharray': dash } : {}),
        'data-layer': layer.id,
      }),
    );
    layer.points.forEach((p, i) => {
      if (p === null) {
        if (li === 0) thinEverywhere.add(i);
        return;
      }
      const key = model.axes[i]?.key ?? '';
      root.appendChild(
        svg('circle', {
          cx: p.x,
          cy: p.y,
          r: 3,
          fill: colour,
          class: options.pulse?.includes(key) && li === 0 ? 'radar-dot pulse' : 'radar-dot',
        }),
      );
    });
  });
  for (const i of thinEverywhere) {
    const axis = model.axes[i];
    if (!axis) continue;
    root.appendChild(
      svg('line', {
        x1: model.centre.x,
        y1: model.centre.y,
        x2: axis.end.x,
        y2: axis.end.y,
        stroke: RADAR_COLOURS.thin,
        'stroke-width': 1.5,
        'stroke-dasharray': '3 3',
        'data-thin': axis.key,
      }),
    );
  }
  model.axes.forEach((axis, i) => {
    const thin = thinEverywhere.has(i);
    const label = svg('text', {
      x: axis.labelAt.x,
      y: axis.labelAt.y,
      'text-anchor': axis.anchor,
      'dominant-baseline': 'middle',
      class: options.pulse?.includes(axis.key) ? 'radar-label pulse' : 'radar-label',
      fill: thin ? RADAR_COLOURS.thin : 'currentColor',
      'font-size': 9,
    });
    label.appendChild(svg('tspan', {}, axis.label));
    if (thin)
      label.appendChild(
        svg('tspan', { x: axis.labelAt.x, dy: 10, 'font-size': 7.5 }, 'not enough data'),
      );
    root.appendChild(label);
  });
  return root;
}
