export type AnimationName = 'idle' | 'walk' | 'jog' | 'sprint' | 'crouch' | 'crouchWalk' | 'air';

export interface MotionState {
  /** Horizontal speed, m/s. */
  readonly speed: number;
  readonly crouching: boolean;
  readonly onGround: boolean;
}

/** Speeds (m/s) that separate the animations. Derived from movement settings, not guessed. */
export interface AnimationThresholds {
  /** Below this the character counts as standing still. */
  readonly moving: number;
  /** At or above this the jog cycle plays instead of the slow walk. */
  readonly jogging: number;
  /** At or above this the sprint cycle plays. */
  readonly sprinting: number;
}

export function thresholdsFor(walkSpeed: number, sprintSpeed: number): AnimationThresholds {
  return { moving: 0.4, jogging: 2.6, sprinting: (walkSpeed + sprintSpeed) / 2 };
}

/** Chooses the clip for the current motion. Pure, so it is shared by the local and remote players. */
export function selectAnimation(motion: MotionState, t: AnimationThresholds): AnimationName {
  if (!motion.onGround) return 'air';
  if (motion.crouching) return motion.speed >= t.moving ? 'crouchWalk' : 'crouch';
  if (motion.speed < t.moving) return 'idle';
  if (motion.speed >= t.sprinting) return 'sprint';
  return motion.speed >= t.jogging ? 'jog' : 'walk';
}
