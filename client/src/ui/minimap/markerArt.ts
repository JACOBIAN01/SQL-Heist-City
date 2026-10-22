import type { MapPoint, Marker } from './minimapModel';

/** Map colours shared by the minimap and the full-screen map. */
export const MAP_COLOURS = {
  street: '#2b2f36',
  sidewalk: '#5a5f68',
  building: '#8a8f99',
  bankRing: '#ffd34d',
  alert: '#ff4d4d',
  safehouse: '#3ddc84',
  hospital: '#e5484d',
  bag: '#ffd34d',
  wanted: '#ff6a00',
  mate: '#3ec1d3',
  foe: '#ff4d4d',
  objective: '#ffd34d',
  player: '#ffffff',
};

/**
 * Draws one marker's symbol centred on `at` (canvas pixels): banks with their
 * tier and a ring filling as locks open, safehouses, the hospital, bags, the
 * wanted and the tutorial's objective. Shared by the minimap and the full map,
 * so a symbol means the same thing on both.
 * Pattern: Strategy (one drawing per marker kind) — Why: a new kind of marker
 * is one more case here, and both maps pick it up.
 */
export function drawMarker(
  ctx: CanvasRenderingContext2D,
  m: Marker,
  at: MapPoint,
  now: number,
): void {
  const label = (text: string, colour: string, size: number) => {
    ctx.fillStyle = colour;
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, at.x, at.y + 0.5);
  };
  switch (m.kind) {
    case 'bag':
      ctx.fillStyle = MAP_COLOURS.bag;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'wanted':
      // A price on their head: an orange diamond with a dollar sign.
      ctx.fillStyle = MAP_COLOURS.wanted;
      ctx.beginPath();
      ctx.moveTo(at.x, at.y - 8);
      ctx.lineTo(at.x + 7, at.y);
      ctx.lineTo(at.x, at.y + 8);
      ctx.lineTo(at.x - 7, at.y);
      ctx.closePath();
      ctx.fill();
      label('$', '#1a0a00', 9);
      return;
    case 'mate':
      // A squad-mate: a teal disc with their initial.
      ctx.fillStyle = MAP_COLOURS.mate;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 6, 0, Math.PI * 2);
      ctx.fill();
      label((m.name ?? '?').slice(0, 1).toUpperCase(), '#04262b', 9);
      return;
    case 'foe':
      // A rival the lookout sees: a small red triangle.
      ctx.fillStyle = MAP_COLOURS.foe;
      ctx.beginPath();
      ctx.moveTo(at.x, at.y - 5);
      ctx.lineTo(at.x + 4.5, at.y + 4);
      ctx.lineTo(at.x - 4.5, at.y + 4);
      ctx.closePath();
      ctx.fill();
      return;
    case 'objective':
      // The tutorial's "go here": a pulsing yellow ring.
      ctx.strokeStyle = MAP_COLOURS.objective;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 6 + 2 * Math.sin(now * 4), 0, Math.PI * 2);
      ctx.stroke();
      return;
    case 'safehouse':
      ctx.fillStyle = MAP_COLOURS.safehouse;
      ctx.fillRect(at.x - 5, at.y - 5, 10, 10);
      label('S', '#05210f', 9);
      return;
    case 'hospital':
      ctx.fillStyle = MAP_COLOURS.hospital;
      ctx.fillRect(at.x - 6, at.y - 6, 12, 12);
      label('H', '#ffffff', 10);
      return;
    case 'bank':
      drawBank(ctx, m, at, now);
      return;
  }
}

/** A bank: its tier in a dark disc, a ring filling as locks open, red pulses while the alarm rings. */
function drawBank(ctx: CanvasRenderingContext2D, m: Marker, at: MapPoint, now: number): void {
  const locks = m.locks ?? 0;
  const opened = m.opened ?? 0;
  const open = locks > 0 && opened >= locks;
  if (m.alert) {
    const pulse = 0.5 + 0.5 * Math.sin(now * 8);
    ctx.strokeStyle = MAP_COLOURS.alert;
    ctx.globalAlpha = 0.4 + 0.6 * pulse;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(at.x, at.y, 11 + 3 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.globalAlpha = m.closed ? 0.45 : 1;
  ctx.fillStyle = open ? MAP_COLOURS.bankRing : '#15181d';
  ctx.beginPath();
  ctx.arc(at.x, at.y, 7, 0, Math.PI * 2);
  ctx.fill();
  if (locks > 0 && opened > 0 && !open) {
    ctx.strokeStyle = MAP_COLOURS.bankRing;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(at.x, at.y, 8.5, -Math.PI / 2, -Math.PI / 2 + (opened / locks) * Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = open ? '#15181d' : MAP_COLOURS.bankRing;
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(m.tier ?? ''), at.x, at.y + 0.5);
  if (m.closed) {
    // A slash through it: out of play.
    ctx.strokeStyle = MAP_COLOURS.alert;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(at.x - 8, at.y + 8);
    ctx.lineTo(at.x + 8, at.y - 8);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
