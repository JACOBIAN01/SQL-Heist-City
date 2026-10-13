import { describe, expect, it } from 'vitest';
import { DEFAULT_VEHICLE_SETTINGS } from '@heist/shared';
import { RunOverRule, runOverDamage } from './RunOverRule';

const rule = DEFAULT_VEHICLE_SETTINGS.runOver;
const sedan = DEFAULT_VEHICLE_SETTINGS.kinds.sedan;
const suv = DEFAULT_VEHICLE_SETTINGS.kinds.suv;

describe('runOverDamage', () => {
  it('is nothing at or below the speed floor', () => {
    expect(runOverDamage(0, sedan, rule)).toBe(0);
    expect(runOverDamage(rule.minSpeed, sedan, rule)).toBe(0);
    expect(runOverDamage(-rule.minSpeed, sedan, rule)).toBe(0);
  });

  it('grows with speed and with mass, and counts reversing', () => {
    expect(runOverDamage(12, sedan, rule)).toBeGreaterThan(runOverDamage(8, sedan, rule));
    expect(runOverDamage(12, suv, rule)).toBeGreaterThan(runOverDamage(12, sedan, rule));
    expect(runOverDamage(-12, sedan, rule)).toBe(runOverDamage(12, sedan, rule));
  });

  it('kills at a car’s top speed with default numbers', () => {
    expect(runOverDamage(sedan.maxSpeed, sedan, rule)).toBeGreaterThanOrEqual(100);
  });
});

describe('RunOverRule', () => {
  const car = (speed: number) => ({ state: { x: 0, z: 0, yaw: 0, speed, steer: 0 }, spec: sedan });
  const person = (z: number, y = 0) => ({ id: 7, x: 0, z, y });
  const make = () => new RunOverRule(rule, 20, 0.4, 1.4);

  it('hits a person at the nose and misses one further off', () => {
    expect(make().hit(1, car(15), person(-2.4))).toBeGreaterThan(0);
    expect(make().hit(1, car(15), person(-6))).toBe(0);
  });

  it('hits once per pass, then again after the cooldown', () => {
    const r = make();
    expect(r.hit(10, car(15), person(-2.4))).toBeGreaterThan(0);
    expect(r.hit(11, car(15), person(-2.4))).toBe(0);
    expect(r.hit(10 + Math.ceil(rule.hitCooldownSec * 20), car(15), person(-2.4))).toBeGreaterThan(
      0,
    );
  });

  it('passes over people on an upper floor', () => {
    expect(make().hit(1, car(15), person(-2.4, 3))).toBe(0);
  });
});
