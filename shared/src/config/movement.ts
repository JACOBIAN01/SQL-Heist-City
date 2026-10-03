import { z } from 'zod';

/**
 * Movement tuning. Defaults only: the admin settings table can override any
 * value (docs/gameplay.md), and server and client must read the same numbers
 * or prediction drifts.
 */
export const movementSettingsSchema = z.object({
  /** m/s */
  walkSpeed: z.number().positive().default(4.2),
  sprintSpeed: z.number().positive().default(6.8),
  crouchSpeed: z.number().positive().default(2.0),
  /** m/s² toward the wanted velocity on the ground / in the air. */
  groundAccel: z.number().positive().default(60),
  airAccel: z.number().positive().default(14),
  /** Initial upward speed of a jump (m/s). With gravity 20 → ~1.1 m high. */
  jumpSpeed: z.number().positive().default(6.7),
  gravity: z.number().positive().default(20),
  /** Fastest fall speed (m/s); keeps fast falls from skipping thin boxes. */
  terminalSpeed: z.number().positive().default(25),
  /** Body size (m). The body is an upright box of this footprint. */
  radius: z.number().positive().default(0.35),
  standHeight: z.number().positive().default(1.8),
  crouchHeight: z.number().positive().default(1.1),
  /** Highest ledge walked up without jumping (stairs, kerbs). */
  stepHeight: z.number().min(0).default(0.35),
});

export type MovementSettings = z.infer<typeof movementSettingsSchema>;
export const DEFAULT_MOVEMENT_SETTINGS: MovementSettings = movementSettingsSchema.parse({});
