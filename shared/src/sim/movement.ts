import type { Aabb, GameMap } from '../world/map';
import type { MovementSettings } from '../config/movement';
import { Button, hasButton, type InputCommand } from './input';

/** Physical state that movement changes. Mutated in place: this is the hot path (no per-tick allocation). */
export interface BodyState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  crouching: boolean;
}

export function createBody(x: number, y: number, z: number): BodyState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: true, crouching: false };
}

export function copyBody(from: BodyState, to: BodyState): void {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.vx = from.vx;
  to.vy = from.vy;
  to.vz = from.vz;
  to.onGround = from.onGround;
  to.crouching = from.crouching;
}

/** Gap left between the body and what it touches, so float error never leaves it "inside". */
const EPS = 1e-4;

export const bodyHeight = (body: BodyState, cfg: MovementSettings): number =>
  body.crouching ? cfg.crouchHeight : cfg.standHeight;

function hits(
  boxes: readonly Aabb[],
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
): Aabb | undefined {
  for (const b of boxes) {
    if (
      x - r < b.maxX &&
      x + r > b.minX &&
      y < b.maxY &&
      y + h > b.minY &&
      z - r < b.maxZ &&
      z + r > b.minZ
    ) {
      return b;
    }
  }
  return undefined;
}

/**
 * Advances one body by one fixed tick of input. Pure apart from mutating
 * `body`, and shared by the server (authority) and the client (prediction):
 * same code + same inputs = same result, which is what keeps prediction
 * honest (docs/Architecture.md, netcode).
 */
export function stepBody(
  body: BodyState,
  cmd: InputCommand,
  dt: number,
  map: GameMap,
  cfg: MovementSettings,
): void {
  const boxes = map.boxes;
  const r = cfg.radius;

  // Crouch: standing back up needs headroom.
  const wantCrouch = hasButton(cmd.buttons, Button.Crouch);
  if (wantCrouch) body.crouching = true;
  else if (body.crouching && !hits(boxes, body.x, body.y, body.z, r, cfg.standHeight)) {
    body.crouching = false;
  }
  const h = bodyHeight(body, cfg);

  // Wanted horizontal velocity from the stick, relative to where we face.
  const mx = cmd.moveX / 127;
  const my = cmd.moveY / 127;
  const sin = Math.sin(cmd.yaw);
  const cos = Math.cos(cmd.yaw);
  let wx = my * -sin + mx * cos;
  let wz = my * -cos + mx * -sin;
  const len = Math.hypot(wx, wz);
  if (len > 1) {
    wx /= len;
    wz /= len;
  }
  const speed = body.crouching
    ? cfg.crouchSpeed
    : hasButton(cmd.buttons, Button.Sprint) && my > 0
      ? cfg.sprintSpeed
      : cfg.walkSpeed;
  const accel = (body.onGround ? cfg.groundAccel : cfg.airAccel) * dt;
  body.vx = approach(body.vx, wx * speed, accel);
  body.vz = approach(body.vz, wz * speed, accel);

  // Vertical: jump, gravity.
  if (body.onGround && hasButton(cmd.buttons, Button.Jump) && !body.crouching) {
    body.vy = cfg.jumpSpeed;
    body.onGround = false;
  }
  body.vy = Math.max(-cfg.terminalSpeed, body.vy - cfg.gravity * dt);

  moveHorizontal(body, 'x', body.vx * dt, boxes, r, h, cfg.stepHeight);
  moveHorizontal(body, 'z', body.vz * dt, boxes, r, h, cfg.stepHeight);
  moveVertical(body, body.vy * dt, boxes, r, h, map.halfSize);
}

function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}

function moveHorizontal(
  body: BodyState,
  axis: 'x' | 'z',
  delta: number,
  boxes: readonly Aabb[],
  r: number,
  h: number,
  stepHeight: number,
): void {
  if (delta === 0) return;
  const next = body[axis] + delta;
  const nx = axis === 'x' ? next : body.x;
  const nz = axis === 'z' ? next : body.z;
  const hit = hits(boxes, nx, body.y, nz, r, h);
  if (!hit) {
    body[axis] = next;
    return;
  }

  // Walk up a low ledge instead of stopping at it.
  if (body.onGround) {
    const lift = hit.maxY - body.y + EPS;
    if (lift <= stepHeight && !hits(boxes, nx, body.y + lift, nz, r, h)) {
      body[axis] = next;
      body.y += lift;
      return;
    }
  }

  // Blocked: rest against the face and lose speed along this axis.
  body[axis] =
    delta > 0
      ? (axis === 'x' ? hit.minX : hit.minZ) - r - EPS
      : (axis === 'x' ? hit.maxX : hit.maxZ) + r + EPS;
  if (axis === 'x') body.vx = 0;
  else body.vz = 0;
}

function moveVertical(
  body: BodyState,
  delta: number,
  boxes: readonly Aabb[],
  r: number,
  h: number,
  halfSize: number,
): void {
  body.onGround = false;
  body.y += delta;

  // Several boxes can overlap at once (stairs): resolve against the extreme one.
  let top = -Infinity;
  let bottom = Infinity;
  let touching = false;
  for (const b of boxes) {
    if (
      body.x - r < b.maxX &&
      body.x + r > b.minX &&
      body.y < b.maxY &&
      body.y + h > b.minY &&
      body.z - r < b.maxZ &&
      body.z + r > b.minZ
    ) {
      touching = true;
      top = Math.max(top, b.maxY);
      bottom = Math.min(bottom, b.minY);
    }
  }
  if (touching) {
    if (delta <= 0) {
      body.y = top;
      body.onGround = true;
    } else {
      body.y = bottom - h - EPS;
    }
    body.vy = 0;
  }
  if (body.y <= 0) {
    body.y = 0;
    body.vy = Math.max(0, body.vy);
    body.onGround = true;
  }

  // Safety net: the walls keep players in, but never trust a single check.
  const limit = halfSize - r;
  body.x = Math.max(-limit, Math.min(limit, body.x));
  body.z = Math.max(-limit, Math.min(limit, body.z));
}

/** A command with no keys held, e.g. to let a body settle. */
export function idleCommand(seq: number, yaw = 0): InputCommand {
  return { seq, moveX: 0, moveY: 0, yaw, pitch: 0, buttons: 0 };
}
