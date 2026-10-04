import { describe, expect, it } from 'vitest';
import { Group, Vector3 } from 'three';
import { DRAW_SECONDS, GunHandling, HOLSTER_SECONDS } from './GunHandling';

const back = new Vector3(0, 1.4, 0.05);
const hand = new Vector3(0.15, 1.45, -0.4);
/** Where the muzzle points, in character space (the barrel is the gun's −z). */
const muzzle = (gun: Group) => new Vector3(0, 0, -1).applyQuaternion(gun.quaternion);

function settle(h: GunHandling, aiming: boolean, seconds: number, gun = new Group()) {
  for (let t = 0; t < seconds; t += 1 / 60) h.update(1 / 60, aiming);
  h.pose(gun, back, hand);
  return gun;
}

describe('GunHandling', () => {
  it('slings the gun across the back: behind the body, muzzle down, stock up', () => {
    const gun = settle(new GunHandling(), false, 0.1);
    expect(gun.position.z).toBeGreaterThan(back.z); // behind (the character faces −z)
    expect(muzzle(gun).y).toBeLessThan(-0.7);
  });

  it('points the muzzle forward, at what the player faces, once drawn: never back at the camera', () => {
    const h = new GunHandling();
    const gun = settle(h, true, DRAW_SECONDS + 0.05);
    expect(h.drawn).toBe(true);
    const dir = muzzle(gun);
    expect(dir.z).toBeLessThan(-0.99); // straight ahead
    expect(gun.position.distanceTo(hand)).toBeLessThan(0.01);
  });

  it('follows the aim up and down', () => {
    const h = new GunHandling();
    h.setPitch(0.4);
    const up = muzzle(settle(h, true, 1));
    expect(up.y).toBeCloseTo(Math.sin(0.4), 2);
    h.setPitch(-0.3);
    const down = muzzle(settle(h, true, 0.1));
    expect(down.y).toBeCloseTo(Math.sin(-0.3), 2);
  });

  it('draws over a short, smooth arc instead of jumping', () => {
    const h = new GunHandling();
    const gun = new Group();
    let last = settle(h, false, 0.1, gun).position.clone();
    let biggestStep = 0;
    for (let t = 0; t < DRAW_SECONDS + 0.1; t += 1 / 60) {
      h.update(1 / 60, true);
      h.pose(gun, back, hand);
      biggestStep = Math.max(biggestStep, gun.position.distanceTo(last));
      last = gun.position.clone();
    }
    expect(biggestStep).toBeLessThan(0.08); // no frame moves the gun more than 8 cm
  });

  it('kicks back and up on a shot and settles within a fraction of a second', () => {
    const h = new GunHandling();
    const gun = settle(h, true, 1);
    const rest = { pos: gun.position.clone(), dir: muzzle(gun) };
    h.fire();
    h.update(1 / 60, true);
    h.pose(gun, back, hand);
    expect(gun.position.z).toBeGreaterThan(rest.pos.z); // pushed back toward the shoulder
    expect(muzzle(gun).y).toBeGreaterThan(rest.dir.y); // muzzle climbs
    expect(muzzle(gun).z).toBeLessThan(-0.99); // still pointing at the target
    settle(h, true, 0.4, gun);
    expect(gun.position.distanceTo(rest.pos)).toBeLessThan(0.002);
  });

  it('goes back on the sling when the player stops aiming', () => {
    const h = new GunHandling();
    settle(h, true, 1);
    const gun = settle(h, false, HOLSTER_SECONDS + 0.05);
    expect(h.drawn).toBe(false);
    expect(muzzle(gun).y).toBeLessThan(-0.7);
  });
});
