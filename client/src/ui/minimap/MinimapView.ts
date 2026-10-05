import type { GameMap } from '@heist/shared';
import { h } from '../dom';
import { pinToRim, project, type Marker } from './minimapModel';

/** Minimap size on screen (CSS px) and how much of the world it shows (m, centre to rim). */
const SIZE = 180;
const RANGE = 110;
const PX_PER_M = SIZE / 2 / RANGE;
/** The street plan is drawn once at this resolution, then turned and scaled each frame. */
const BASE_PX_PER_M = 2;
const MAX_BASE_PX = 1024;

const COLOURS = {
  street: '#2b2f36',
  sidewalk: '#5a5f68',
  building: '#8a8f99',
  bankRing: '#ffd34d',
  alert: '#ff4d4d',
  safehouse: '#3ddc84',
  bag: '#ffd34d',
  wanted: '#ff6a00',
  player: '#ffffff',
};

/** Boxes at street level this tall or more are walls and buildings on the plan. */
const SOLID = 1.2;
const LOW = 0.3;

/**
 * Draws the street plan once: streets, sidewalks and building footprints from
 * the map's colliders, so it works for the city and the test maps alike.
 */
export function drawStreetPlan(ctx: CanvasRenderingContext2D, map: GameMap, pxPerM: number): void {
  const half = map.halfSize;
  ctx.fillStyle = COLOURS.street;
  ctx.fillRect(0, 0, half * 2 * pxPerM, half * 2 * pxPerM);
  const rect = (b: GameMap['boxes'][number]) =>
    ctx.fillRect(
      (b.minX + half) * pxPerM,
      (b.minZ + half) * pxPerM,
      (b.maxX - b.minX) * pxPerM,
      (b.maxZ - b.minZ) * pxPerM,
    );
  ctx.fillStyle = COLOURS.sidewalk;
  for (const b of map.boxes) if (b.kind === 'kerb') rect(b);
  ctx.fillStyle = COLOURS.building;
  for (const b of map.boxes) if (b.minY <= LOW && b.maxY >= SOLID && b.kind !== 'kerb') rect(b);
}

/**
 * The HUD minimap: a round window on the street plan that turns with the
 * player (who stays at the centre, facing up), with every bank's vault
 * progress, the safehouses and loose cash on it. Banks and safehouses out of
 * range sit on the rim, pointing the way.
 */
export class MinimapView {
  readonly root: HTMLElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly plan: HTMLCanvasElement | undefined;
  private readonly basePxPerM: number;

  constructor(
    host: HTMLElement,
    private readonly map: GameMap,
  ) {
    const canvas = h('canvas', { class: 'hud-minimap' });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    this.root = canvas;
    host.append(canvas);
    this.ctx = canvas.getContext('2d');
    this.ctx?.scale(dpr, dpr);
    this.basePxPerM = Math.min(BASE_PX_PER_M, MAX_BASE_PX / (map.halfSize * 2));
    if (this.ctx) {
      const plan = document.createElement('canvas');
      plan.width = plan.height = Math.ceil(map.halfSize * 2 * this.basePxPerM);
      const pctx = plan.getContext('2d');
      if (pctx) drawStreetPlan(pctx, map, this.basePxPerM);
      this.plan = plan;
    }
  }

  draw(
    player: { x: number; z: number; yaw: number },
    markers: readonly Marker[],
    nowSeconds: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const r = SIZE / 2;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = COLOURS.street;
    ctx.fillRect(0, 0, SIZE, SIZE);
    // The plan, turned so the player's heading is up, scaled from plan pixels to minimap pixels.
    if (this.plan) {
      ctx.save();
      ctx.translate(r, r);
      ctx.rotate(player.yaw);
      ctx.scale(PX_PER_M / this.basePxPerM, PX_PER_M / this.basePxPerM);
      ctx.translate(
        -(player.x + this.map.halfSize) * this.basePxPerM,
        -(player.z + this.map.halfSize) * this.basePxPerM,
      );
      ctx.drawImage(this.plan, 0, 0);
      ctx.restore();
    }
    ctx.translate(r, r);
    for (const m of markers) this.marker(ctx, m, player, nowSeconds, r);
    // The player: an arrow pointing up (the way they face).
    ctx.fillStyle = COLOURS.player;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    // North, on the rim.
    const north = project(0, -1, player.yaw, 1);
    const len = Math.hypot(north.x, north.y) || 1;
    ctx.fillStyle = COLOURS.player;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', (north.x / len) * (r - 9), (north.y / len) * (r - 9));
    ctx.restore();
  }

  private marker(
    ctx: CanvasRenderingContext2D,
    m: Marker,
    player: { x: number; z: number; yaw: number },
    now: number,
    r: number,
  ): void {
    const raw = project(m.x - player.x, m.z - player.z, player.yaw, PX_PER_M);
    const rim = r - 10;
    const at = m.pinned ? pinToRim(raw, rim) : raw;
    if (!m.pinned && Math.hypot(at.x, at.y) > r) return;
    if (m.kind === 'bag') {
      ctx.fillStyle = COLOURS.bag;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (m.kind === 'wanted') {
      // A price on their head: an orange diamond with a dollar sign.
      ctx.fillStyle = COLOURS.wanted;
      ctx.beginPath();
      ctx.moveTo(at.x, at.y - 8);
      ctx.lineTo(at.x + 7, at.y);
      ctx.lineTo(at.x, at.y + 8);
      ctx.lineTo(at.x - 7, at.y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#1a0a00';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', at.x, at.y + 0.5);
      return;
    }
    if (m.kind === 'safehouse') {
      ctx.fillStyle = COLOURS.safehouse;
      ctx.fillRect(at.x - 5, at.y - 5, 10, 10);
      ctx.fillStyle = '#05210f';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('S', at.x, at.y + 0.5);
      return;
    }
    // A bank: its tier in a dark disc, a ring filling as locks open, red pulses while the alarm rings.
    const locks = m.locks ?? 0;
    const opened = m.opened ?? 0;
    const open = locks > 0 && opened >= locks;
    if (m.alert) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 8);
      ctx.strokeStyle = COLOURS.alert;
      ctx.globalAlpha = 0.4 + 0.6 * pulse;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 11 + 3 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = open ? COLOURS.bankRing : '#15181d';
    ctx.beginPath();
    ctx.arc(at.x, at.y, 7, 0, Math.PI * 2);
    ctx.fill();
    if (locks > 0 && opened > 0 && !open) {
      ctx.strokeStyle = COLOURS.bankRing;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 8.5, -Math.PI / 2, -Math.PI / 2 + (opened / locks) * Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = open ? '#15181d' : COLOURS.bankRing;
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(m.tier ?? ''), at.x, at.y + 0.5);
  }
}
