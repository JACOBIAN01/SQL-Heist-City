import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { CarriedBag } from './CarriedBag';

const hand = new Vector3(-0.3, 0.85, 0.05);
const hip = new Vector3(0, 0.95, 0);
const spine = new Vector3(0, 1.4, 0.05);

function boxOf(bag: CarriedBag) {
  bag.object.updateMatrixWorld(true);
  return new Box3().setFromObject(bag.object.getObjectByName('cash-bag') ?? bag.object);
}

describe('CarriedBag', () => {
  it('starts hidden', () => expect(new CarriedBag().visible).toBe(false));

  it('hangs from the left hand when walking: below the hand, on the left, without a strap', () => {
    const bag = new CarriedBag();
    bag.visible = true;
    bag.pose(hand, hip, spine, 0);
    const box = boxOf(bag);
    expect(box.max.y).toBeLessThanOrEqual(hand.y + 0.01);
    expect(box.max.y).toBeGreaterThan(hand.y - 0.1); // the handle is in the fist
    expect((box.min.x + box.max.x) / 2).toBeLessThan(-0.2); // left side
    expect(box.min.y).toBeGreaterThan(0.2); // off the ground
    expect(bag.object.children[1]?.visible).toBe(false);
  });

  it('is long front-to-back, so it hangs along the leg rather than across it', () => {
    const bag = new CarriedBag();
    bag.visible = true;
    bag.pose(hand, hip, spine, 0);
    const size = boxOf(bag).getSize(new Vector3());
    expect(size.z).toBeGreaterThan(size.x);
  });

  it('moves onto a shoulder strap at the left hip while the hands are on the gun', () => {
    const bag = new CarriedBag();
    bag.visible = true;
    const raisedHand = new Vector3(-0.05, 1.45, -0.4); // up at the gun
    bag.pose(raisedHand, hip, spine, 1);
    const box = boxOf(bag);
    expect(box.max.y).toBeLessThan(hip.y + 0.3); // not up at the face with the hand
    expect((box.min.x + box.max.x) / 2).toBeLessThan(-0.2);
    const strap = bag.object.children[1];
    expect(strap?.visible).toBe(true);
    expect(strap?.scale.y).toBeGreaterThan(0.3); // reaches the shoulder
  });
});
