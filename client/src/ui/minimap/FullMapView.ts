import { BANK_LAYOUTS, type CityLayout, type GameMap } from '@heist/shared';
import { h } from '../dom';
import { drawMarker, MAP_COLOURS } from './markerArt';
import type { MapPoint, Marker } from './minimapModel';
import { streetPlanCanvas } from './MinimapView';

/** How the whole map fits a canvas, north up. */
export interface MapFit {
  readonly half: number;
  /** Canvas pixels per metre. */
  readonly scale: number;
  /** Canvas pixel of the map's north-west corner. */
  readonly ox: number;
  readonly oy: number;
}

/** Fits the square map, north up, as large as it goes in `width` × `height`, inside a margin. */
export function fitMap(half: number, width: number, height: number, margin = 24): MapFit {
  const side = Math.max(1, Math.min(width, height) - 2 * margin);
  const scale = side / (half * 2);
  return { half, scale, ox: (width - side) / 2, oy: (height - side) / 2 };
}

/** Where a world point lands on the fitted map (+x right, +z down: north up). */
export const toScreen = (fit: MapFit, x: number, z: number): MapPoint => ({
  x: fit.ox + (x + fit.half) * fit.scale,
  y: fit.oy + (z + fit.half) * fit.scale,
});

/** Street plan resolution for the full map (drawn once). */
const PLAN_PX_PER_M = 3;
const MAX_PLAN_PX = 2048;

/** What each symbol means, shown under the map. */
const LEGEND: readonly [string, string][] = [
  ['1–5', 'bank (ring: locks cracked)'],
  ['S', 'safehouse: bank your cash'],
  ['H', 'hospital'],
  ['$', 'wanted: bounty'],
  ['●', 'cash bag'],
  ['▲', 'you'],
];

/**
 * The full-screen map (M): the whole city, north up, with every bank's name
 * and vault progress, the safehouses, the hospital, the wanted, bags and you.
 * It never pauses the game: the world keeps running behind it, as everything
 * here does.
 */
export class FullMapView {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private plan: HTMLCanvasElement | undefined;
  private readonly planPxPerM: number;
  private shown = false;
  /** Districts explored so far (Phase 30.5); undefined shows the whole map. */
  explored: ReadonlySet<string> | undefined;

  constructor(
    host: HTMLElement,
    private readonly map: GameMap,
  ) {
    this.canvas = h('canvas', { class: 'hud-fullmap-canvas' });
    this.root = h(
      'div',
      { class: 'hud-fullmap' },
      h('div', { class: 'hud-fullmap-title', text: 'City map · M or Esc to close' }),
      this.canvas,
      h(
        'div',
        { class: 'hud-fullmap-legend' },
        ...LEGEND.map(([sym, what]) =>
          h('span', {}, h('b', { text: sym }), h('span', { text: ` ${what}` })),
        ),
      ),
    );
    this.root.hidden = true;
    host.append(this.root);
    this.ctx = this.canvas.getContext('2d');
    this.planPxPerM = Math.min(PLAN_PX_PER_M, MAX_PLAN_PX / (map.halfSize * 2));
  }

  get isOpen(): boolean {
    return this.shown;
  }

  toggle(): void {
    this.setOpen(!this.shown);
  }

  setOpen(open: boolean): void {
    this.shown = open;
    this.root.hidden = !open;
  }

  draw(
    player: { x: number; z: number; yaw: number },
    markers: readonly Marker[],
    now: number,
  ): void {
    const ctx = this.ctx;
    if (!this.shown || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, this.canvas.clientWidth);
    const hgt = Math.max(1, this.canvas.clientHeight);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(hgt * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(hgt * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const fit = fitMap(this.map.halfSize, w, hgt);
    this.plan ??= streetPlanCanvas(this.map, this.planPxPerM);
    ctx.fillStyle = MAP_COLOURS.street;
    ctx.fillRect(fit.ox, fit.oy, fit.half * 2 * fit.scale, fit.half * 2 * fit.scale);
    ctx.drawImage(this.plan, fit.ox, fit.oy, fit.half * 2 * fit.scale, fit.half * 2 * fit.scale);
    if (this.map.city) drawDistricts(ctx, fit, this.map.city, this.explored);
    for (const m of markers) {
      const at = toScreen(fit, m.x, m.z);
      drawMarker(ctx, m, at, now);
      this.caption(ctx, m, at);
    }
    // You: an arrow the way you face.
    const me = toScreen(fit, player.x, player.z);
    ctx.save();
    ctx.translate(me.x, me.y);
    ctx.rotate(-player.yaw);
    ctx.fillStyle = MAP_COLOURS.player;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
    // North.
    ctx.fillStyle = MAP_COLOURS.player;
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('N ↑', fit.ox + fit.half * fit.scale, fit.oy + 4);
  }

  /** The words next to a marker: a bank's name and locks, a wanted player's name. */
  private caption(ctx: CanvasRenderingContext2D, m: Marker, at: MapPoint): void {
    const text = captionFor(m);
    if (!text) return;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(text, at.x + 13, at.y);
    ctx.fillStyle = m.kind === 'wanted' ? MAP_COLOURS.wanted : '#fff';
    ctx.fillText(text, at.x + 13, at.y);
  }
}

const css = (tint: number, alpha: number): string =>
  `rgba(${(tint >> 16) & 255},${(tint >> 8) & 255},${tint & 255},${alpha})`;

/**
 * Districts on the full map (Phase 30.1): each block washed in its district's colour, the district's
 * name across its middle and a star with the name of its landmark, so places can be told apart and
 * named at a glance.
 */
export function drawDistricts(
  ctx: CanvasRenderingContext2D,
  fit: MapFit,
  city: CityLayout,
  /** The districts explored so far; everything else stays under fog. Omit to show all. */
  explored?: ReadonlySet<string>,
): void {
  const tint = new Map(city.districts.map((d) => [d.id, d.tint]));
  const known = (id: string) => explored === undefined || explored.has(id);
  for (const b of city.blocks) {
    const colour = tint.get(b.district);
    if (colour === undefined) continue;
    const a = toScreen(fit, b.outer.minX, b.outer.minZ);
    const z = toScreen(fit, b.outer.maxX, b.outer.maxZ);
    // Unexplored: a dark cloud over the streets, not the district's colour.
    ctx.fillStyle = known(b.district) ? css(colour, 0.28) : 'rgba(12,16,22,0.88)';
    ctx.fillRect(a.x, a.y, z.x - a.x, z.y - a.y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  for (const d of city.districts) {
    const at = toScreen(fit, d.x, d.z);
    ctx.font = '700 15px system-ui, sans-serif';
    if (!known(d.id)) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText('?', at.x, at.y);
      continue;
    }
    ctx.strokeText(d.name.toUpperCase(), at.x, at.y);
    ctx.fillStyle = css(d.tint, 1);
    ctx.fillText(d.name.toUpperCase(), at.x, at.y);
    if (!d.landmark) continue;
    const l = toScreen(fit, d.landmark.x, d.landmark.z);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.strokeText(`★ ${d.landmark.name}`, l.x, l.y);
    ctx.fillStyle = '#fff';
    ctx.fillText(`★ ${d.landmark.name}`, l.x, l.y);
  }
}

/** A marker's caption on the full map, or nothing. */
export function captionFor(m: Marker): string | undefined {
  if (m.kind === 'bank') {
    const name = BANK_LAYOUTS.get(m.tier ?? 0)?.name ?? `Bank ${m.tier ?? ''}`;
    if (m.closed) return `${name} · CLOSED`;
    const locks = m.locks ?? 0;
    if (locks === 0) return name;
    return (m.opened ?? 0) >= locks
      ? `${name} · OPEN`
      : `${name} · ${m.opened ?? 0}/${locks} locks`;
  }
  if (m.kind === 'wanted') return m.name;
  if (m.kind === 'hospital') return 'Hospital';
  return undefined;
}
