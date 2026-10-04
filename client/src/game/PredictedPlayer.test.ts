import { describe, expect, it } from 'vitest';
import {
  Button,
  DEFAULT_MOVEMENT_SETTINGS,
  Flag,
  SIM_DT,
  TEST_MAP,
  createBody,
  stepBody,
  type BodyState,
  type InputCommand,
  type SelfState,
} from '@heist/shared';
import { LocalPlayer } from './LocalPlayer';
import { PredictedPlayer } from './PredictedPlayer';

const spawn = { x: 0, z: 0, yaw: 0 };
const cmd = (seq: number, over: Partial<InputCommand> = {}): InputCommand => ({
  seq,
  moveX: 0,
  moveY: 0,
  yaw: 0,
  pitch: 0,
  buttons: 0,
  viewLagMs: 0,
  ...over,
});

const selfOf = (b: BodyState): SelfState => ({
  x: Math.fround(b.x),
  y: Math.fround(b.y),
  z: Math.fround(b.z),
  vx: Math.round(b.vx * 1000) / 1000, // the wire carries velocity in mm/s
  vy: Math.round(b.vy * 1000) / 1000, // the wire carries velocity in mm/s
  vz: Math.round(b.vz * 1000) / 1000, // the wire carries velocity in mm/s
  flags: (b.onGround ? Flag.OnGround : 0) | (b.crouching ? Flag.Crouching : 0) | Flag.Alive,
  hp: 100,
});

/**
 * A scripted match between a predicting client and a stand-in authoritative
 * server (same shared step, 20 Hz ticks, 6-command budget, f32 snapshots),
 * with `latencyMs` each way on a virtual clock.
 */
function simulate(
  script: (tick: number) => Partial<InputCommand>,
  seconds: number,
  latencyMs: number,
) {
  const predicted = new PredictedPlayer(
    new LocalPlayer(TEST_MAP, DEFAULT_MOVEMENT_SETTINGS, spawn),
  );
  const server = createBody(0, 0, 0);
  const toServer: { at: number; commands: InputCommand[] }[] = [];
  const toClient: { at: number; self: SelfState; ack: number }[] = [];
  const queue: InputCommand[] = [];
  let ack = 0;
  let seq = 0;
  let maxError = 0;
  let unsent: InputCommand[] = [];
  const drawJumps: number[] = [];
  let lastDraw = { x: 0, y: 0, z: 0 };
  const out = { x: 0, y: 0, z: 0 };

  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    const t = i * SIM_DT * 1000;
    // client: sample + predict, flush a batch every 3rd tick (~20 Hz)
    seq = (seq + 1) & 0xffff;
    const command = cmd(seq, script(i));
    predicted.predict(command);
    unsent.push(command);
    if (i % 3 === 2) {
      toServer.push({ at: t + latencyMs, commands: unsent });
      unsent = [];
    }
    // server: deliver, then tick every 3rd step
    while (toServer[0] && toServer[0].at <= t) queue.push(...(toServer.shift()?.commands ?? []));
    if (i % 3 === 2) {
      for (let k = 0; k < 6 && queue.length > 0; k++) {
        const c = queue.shift() as InputCommand;
        stepBody(server, c, SIM_DT, TEST_MAP, DEFAULT_MOVEMENT_SETTINGS);
        ack = c.seq;
      }
      toClient.push({ at: t + latencyMs, self: selfOf(server), ack });
    }
    // client: receive snapshots
    while (toClient[0] && toClient[0].at <= t) {
      const s = toClient.shift();
      if (s) {
        predicted.reconcile(s.self, s.ack);
        maxError = Math.max(maxError, predicted.lastCorrection);
      }
    }
    predicted.smooth(SIM_DT);
    predicted.drawPosition(1, out);
    drawJumps.push(Math.hypot(out.x - lastDraw.x, out.y - lastDraw.y, out.z - lastDraw.z));
    lastDraw = { ...out };
  }
  return { predicted, maxError, maxDrawJump: Math.max(...drawJumps) };
}

describe('PredictedPlayer', () => {
  const walkAndJump = (tick: number): Partial<InputCommand> => {
    const phase = Math.floor(tick / 40) % 6;
    return [
      { moveY: 127 },
      { moveY: 127, moveX: 127, buttons: Button.Sprint, yaw: 1 },
      { moveX: -127, buttons: Button.Jump },
      { moveY: 127, buttons: Button.Crouch, yaw: 2 },
      { moveY: 127, yaw: 3.5, buttons: Button.Sprint | Button.Jump },
      {},
    ][phase] as Partial<InputCommand>;
  };

  it.each([0, 50, 100, 200])('has no visible corrections at %i ms latency', (latency) => {
    const { maxError, maxDrawJump } = simulate(walkAndJump, 12, latency);
    // Only f32 wire rounding remains; the drawn position never jumps beyond normal speed.
    expect(maxError).toBeLessThan(0.01);
    expect(maxDrawJump).toBeLessThan(DEFAULT_MOVEMENT_SETTINGS.sprintSpeed * SIM_DT * 1.5);
  });

  it('stays correct when running into a wall and sliding along it', () => {
    const { maxError } = simulate(() => ({ moveY: 127, moveX: 60, yaw: 0.3 }), 20, 100);
    expect(maxError).toBeLessThan(0.01);
  });

  it('drops acknowledged commands and keeps the rest for replay', () => {
    const predicted = new PredictedPlayer(
      new LocalPlayer(TEST_MAP, DEFAULT_MOVEMENT_SETTINGS, spawn),
    );
    for (let seq = 1; seq <= 10; seq++) predicted.predict(cmd(seq, { moveY: 127 }));
    const server = createBody(0, 0, 0);
    for (let seq = 1; seq <= 6; seq++)
      stepBody(server, cmd(seq, { moveY: 127 }), SIM_DT, TEST_MAP, DEFAULT_MOVEMENT_SETTINGS);
    predicted.reconcile(selfOf(server), 6);
    expect(predicted.pendingCount).toBe(4);
  });

  it('glides to a genuine correction instead of snapping', () => {
    const predicted = new PredictedPlayer(
      new LocalPlayer(TEST_MAP, DEFAULT_MOVEMENT_SETTINGS, spawn),
    );
    predicted.predict(cmd(1));
    const out = { x: 0, y: 0, z: 0 };
    predicted.drawPosition(1, out);
    const before = out.x;
    // Server says we were shoved 0.5 m to the right.
    predicted.reconcile({ ...selfOf(createBody(0.5, 0, 0)), flags: Flag.OnGround | Flag.Alive }, 1);
    predicted.drawPosition(1, out);
    expect(out.x).toBeCloseTo(before, 3); // no visible jump
    for (let i = 0; i < 60; i++) predicted.smooth(SIM_DT);
    predicted.drawPosition(1, out);
    expect(out.x).toBeCloseTo(0.5, 2); // converged to the server's truth
  });

  it('snaps on a teleport-sized correction (respawn)', () => {
    const predicted = new PredictedPlayer(
      new LocalPlayer(TEST_MAP, DEFAULT_MOVEMENT_SETTINGS, spawn),
    );
    predicted.reconcile(selfOf(createBody(30, 0, -20)), 0);
    const out = { x: 0, y: 0, z: 0 };
    predicted.drawPosition(1, out);
    expect([out.x, out.z]).toEqual([30, -20]);
  });
});
