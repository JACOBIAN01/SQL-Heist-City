export type AnimationName = 'idle' | 'walk' | 'run' | 'crouch' | 'crouchWalk' | 'air';

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
  /** At or above this the run cycle plays instead of the walk cycle. */
  readonly running: number;
}

export function thresholdsFor(walkSpeed: number, sprintSpeed: number): AnimationThresholds {
  return { moving: 0.4, running: (walkSpeed + sprintSpeed) / 2 };
}

/** Chooses the clip for the current motion. Pure, so it is shared by the local and remote players. */
export function selectAnimation(motion: MotionState, t: AnimationThresholds): AnimationName {
  if (!motion.onGround) return 'air';
  if (motion.crouching) return motion.speed >= t.moving ? 'crouchWalk' : 'crouch';
  if (motion.speed < t.moving) return 'idle';
  return motion.speed >= t.running ? 'run' : 'walk';
}
