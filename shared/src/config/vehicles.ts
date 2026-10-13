import { z } from 'zod';

/**
 * How a kind of vehicle drives. Defaults only (admin-overridable like the
 * rest of the settings); server and client must use the same numbers or
 * prediction drifts. Arcade-realistic: grippy, readable, no drifting physics.
 */
export const vehicleSpecSchema = z.object({
  /** Top speed forward / in reverse, m/s (20 m/s = 72 km/h, brisk for a city). */
  maxSpeed: z.number().positive(),
  reverseSpeed: z.number().positive(),
  /** Throttle and brake, m/s². */
  accel: z.number().positive(),
  brake: z.number().positive(),
  /** Slowing with no pedal pressed, m/s². */
  coast: z.number().positive(),
  /** Front-wheel angle at full lock (rad), how fast the wheels turn (rad/s), and what share of full lock is left at top speed. */
  maxSteer: z.number().positive(),
  steerSpeed: z.number().positive(),
  highSpeedSteer: z.number().min(0).max(1),
  /** Distance between the axles, m: with the wheel angle it sets the turning circle. */
  wheelBase: z.number().positive(),
  /** Collision footprint, m. */
  length: z.number().positive(),
  width: z.number().positive(),
  /** Share of speed kept (reversed) after driving into a wall. */
  bounce: z.number().min(0).max(1),
  /** Car mass, kg: a heavier car hurts more at the same speed (run-over damage). */
  mass: z.number().positive(),
});

export type VehicleSpec = z.infer<typeof vehicleSpecSchema>;

export const VEHICLE_KINDS = ['sedan', 'sports', 'suv'] as const;
export type VehicleKind = (typeof VEHICLE_KINDS)[number];

/** What a moving car does to a person it hits. Damage comes from speed and mass; a nudge does nothing. */
export const runOverSchema = z.object({
  /** Below this speed (m/s) a car only shoves people. */
  minSpeed: z.number().min(0).default(5),
  /** Hit points per m/s above `minSpeed`, per 1000 kg of car. */
  damagePerSpeed: z.number().min(0).default(5),
  /** A person can be hit again only after this many seconds (one pass is one hit, not one per tick). */
  hitCooldownSec: z.number().min(0).default(0.6),
  /** How far (m) from the car's body a person still counts as touched. */
  reach: z.number().min(0).default(0.35),
});

export type RunOverSettings = z.infer<typeof runOverSchema>;

export const vehicleSettingsSchema = z.object({
  /** Run-over damage (12.3). */
  runOver: runOverSchema.default(() => runOverSchema.parse({})),
  /** How close to a car's side (m, from its footprint) a player must stand to get in. */
  enterRange: z.number().positive().default(1.6),
  /** Fastest a car may be going (m/s) for its driver to get out. */
  exitMaxSpeed: z.number().positive().default(4),
  kinds: z
    .object({ sedan: vehicleSpecSchema, sports: vehicleSpecSchema, suv: vehicleSpecSchema })
    .default({
      sedan: {
        maxSpeed: 20,
        reverseSpeed: 6,
        accel: 7,
        brake: 16,
        coast: 2.5,
        maxSteer: 0.6,
        steerSpeed: 2.6,
        highSpeedSteer: 0.4,
        wheelBase: 2.4,
        length: 4.2,
        width: 1.8,
        bounce: 0.25,
        mass: 1400,
      },
      sports: {
        maxSpeed: 26,
        reverseSpeed: 6,
        accel: 10,
        brake: 20,
        coast: 2.5,
        maxSteer: 0.55,
        steerSpeed: 3,
        highSpeedSteer: 0.35,
        wheelBase: 2.45,
        length: 4,
        width: 1.85,
        bounce: 0.25,
        mass: 1200,
      },
      suv: {
        maxSpeed: 17,
        reverseSpeed: 5,
        accel: 6,
        brake: 14,
        coast: 2.5,
        maxSteer: 0.6,
        steerSpeed: 2.3,
        highSpeedSteer: 0.45,
        wheelBase: 2.55,
        length: 4.2,
        width: 2.1,
        bounce: 0.2,
        mass: 2000,
      },
    }),
});

export type VehicleSettings = z.infer<typeof vehicleSettingsSchema>;
export const DEFAULT_VEHICLE_SETTINGS: VehicleSettings = vehicleSettingsSchema.parse({});
