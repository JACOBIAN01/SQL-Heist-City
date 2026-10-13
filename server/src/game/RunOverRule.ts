import {
  distanceToCar,
  type CarFootprint,
  type RunOverSettings,
  type VehicleSpec,
} from '@heist/shared';

/**
 * Hit points a car takes off a person at `speed` m/s: nothing below the
 * speed floor, then growing with how far over it the car is and with its mass.
 */
export function runOverDamage(speed: number, spec: VehicleSpec, rule: RunOverSettings): number {
  const over = Math.abs(speed) - rule.minSpeed;
  if (over <= 0) return 0;
  return over * rule.damagePerSpeed * (spec.mass / 1000);
}

/** A person on foot, as the rule sees them. */
export interface Pedestrian {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  /** Feet height; people on an upper floor are above every car. */
  readonly y: number;
}

/**
 * Decides who a moving car runs over.
 *
 * Pattern: Policy object — Why: the damage numbers and the "one pass is one hit"
 * memory live here, so Match only asks "who was hit, for how much" and the rule
 * is tested without a match.
 */
export class RunOverRule {
  /** Tick before which a person cannot be hit again. */
  private readonly nextHit = new Map<number, number>();

  constructor(
    private readonly rule: RunOverSettings,
    private readonly tickRate: number,
    private readonly bodyRadius: number,
    private readonly aboveCars: number,
  ) {}

  /** Damage dealt to `person` by the car this tick, 0 if it misses, is too slow, or hit them a moment ago. */
  hit(tick: number, car: CarFootprint, person: Pedestrian): number {
    if (person.y >= this.aboveCars) return 0;
    if ((this.nextHit.get(person.id) ?? 0) > tick) return 0;
    const damage = runOverDamage(car.state.speed, car.spec, this.rule);
    if (damage <= 0) return 0;
    const gap = distanceToCar(car.state, car.spec, person.x, person.z);
    if (gap > this.bodyRadius + this.rule.reach) return 0;
    this.nextHit.set(person.id, tick + Math.ceil(this.rule.hitCooldownSec * this.tickRate));
    return damage;
  }

  forget(personId: number): void {
    this.nextHit.delete(personId);
  }
}
