import { describe, expect, it } from 'vitest';
import { Button, axisToByte, hasButton, seqNewer } from './input';

describe('input helpers', () => {
  it('quantises axes to a signed byte and clamps', () => {
    expect(axisToByte(1)).toBe(127);
    expect(axisToByte(-1)).toBe(-127);
    expect(axisToByte(0)).toBe(0);
    expect(axisToByte(5)).toBe(127);
  });

  it('tests button bits independently', () => {
    const buttons = Button.Jump | Button.Fire;
    expect(hasButton(buttons, Button.Jump)).toBe(true);
    expect(hasButton(buttons, Button.Crouch)).toBe(false);
  });

  it('orders sequence numbers across the 16-bit wrap', () => {
    expect(seqNewer(5, 4)).toBe(true);
    expect(seqNewer(4, 5)).toBe(false);
    expect(seqNewer(4, 4)).toBe(false);
    expect(seqNewer(2, 65534)).toBe(true);
    expect(seqNewer(65534, 2)).toBe(false);
  });
});
