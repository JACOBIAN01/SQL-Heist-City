import { describe, expect, it } from 'vitest';
import type { InputCommand } from '@heist/shared';
import { InputBatcher } from './InputBatcher';

const cmd = (seq: number): InputCommand => ({
  seq,
  moveX: 0,
  moveY: 0,
  yaw: 0,
  pitch: 0,
  buttons: 0,
  viewLagMs: 0,
});

describe('InputBatcher', () => {
  it('sends the first command immediately, then waits for the interval', () => {
    const sent: number[][] = [];
    const b = new InputBatcher((c) => sent.push(c.map((x) => x.seq)), 33);
    b.push(cmd(1));
    b.flush(0);
    b.push(cmd(2));
    b.flush(16);
    b.push(cmd(3));
    b.flush(34);
    expect(sent).toEqual([[1], [2, 3]]);
  });

  it('sends nothing when idle', () => {
    const sent: unknown[] = [];
    const b = new InputBatcher((c) => sent.push(c));
    b.flush(1000);
    expect(sent).toHaveLength(0);
  });

  it('splits big backlogs into messages of at most 8 commands, in order', () => {
    const sent: number[][] = [];
    const b = new InputBatcher((c) => sent.push(c.map((x) => x.seq)), 33);
    for (let i = 1; i <= 20; i++) b.push(cmd(i));
    b.flush(0);
    expect(sent.map((s) => s.length)).toEqual([8, 8, 4]);
    expect(sent.flat()).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('flushes early once a full message is waiting', () => {
    const sent: number[][] = [];
    const b = new InputBatcher((c) => sent.push(c.map((x) => x.seq)), 1000);
    b.push(cmd(0));
    b.flush(0);
    for (let i = 1; i <= 8; i++) b.push(cmd(i));
    b.flush(5);
    expect(sent).toHaveLength(2);
  });
});
