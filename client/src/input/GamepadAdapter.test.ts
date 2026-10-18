import { describe, expect, it, vi } from 'vitest';
import { GamepadAdapter, shapeStick, type PadState } from './GamepadAdapter';

const pad = (axes: number[], pressed: number[] = []): PadState => ({
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
});

function setup(initial: PadState | null) {
  let state = initial;
  const target = { setStick: vi.fn(), look: vi.fn(), setActionHeld: vi.fn() };
  const actions = { trigger: vi.fn(), setHeld: vi.fn() };
  const cycle = vi.fn();
  const a = new GamepadAdapter(
    () => [state],
    target,
    actions,
    () => ({ deadzone: 0.2, sensitivity: 1 }),
    cycle,
  );
  return { a, target, actions, cycle, set: (s: PadState | null) => (state = s) };
}

describe('GamepadAdapter', () => {
  it('ignores a stick inside the dead zone and rescales outside it', () => {
    expect(shapeStick(0.1, 0.1, 0.2)).toEqual([0, 0]);
    const [x] = shapeStick(1, 0, 0.2);
    expect(x).toBeCloseTo(1);
    const [half] = shapeStick(0.6, 0, 0.2);
    expect(half).toBeCloseTo(0.5);
  });

  it('walks with the left stick (up is forward) and looks with the right', () => {
    const { a, target } = setup(pad([0, -1, 1, 0]));
    a.update(0.1);
    expect(target.setStick).toHaveBeenLastCalledWith(0, 1);
    const [yaw, pitch] = target.look.mock.lastCall as [number, number];
    expect(yaw).toBeGreaterThan(0);
    expect(pitch).toBe(0);
  });

  it('holds fire and aim on the triggers, and does an action once per press', () => {
    const { a, target, actions, cycle, set } = setup(pad([0, 0, 0, 0], [7, 2, 15, 8]));
    a.update(0.016);
    expect(target.setActionHeld).toHaveBeenCalledWith('fire', true);
    expect(target.setActionHeld).toHaveBeenCalledWith('aim', false);
    a.update(0.016);
    expect(actions.trigger).toHaveBeenCalledTimes(1);
    expect(actions.trigger).toHaveBeenCalledWith('use');
    expect(cycle).toHaveBeenCalledWith(1);
    expect(actions.setHeld).toHaveBeenCalledWith('scoreboard', true);
    set(pad([0, 0, 0, 0]));
    a.update(0.016);
    expect(target.setActionHeld).toHaveBeenLastCalledWith('sprint', false);
    expect(actions.setHeld).toHaveBeenLastCalledWith('scoreboard', false);
  });

  it('lets go of everything when the pad is unplugged', () => {
    const { a, target, actions, set } = setup(pad([0, 0, 0, 0], [7, 8]));
    a.update(0.016);
    set(null);
    a.update(0.016);
    expect(target.setActionHeld).toHaveBeenLastCalledWith('sprint', false);
    expect(target.setStick).toHaveBeenLastCalledWith(0, 0);
    expect(actions.setHeld).toHaveBeenLastCalledWith('scoreboard', false);
  });
});
