import type { Object3D } from 'three';
import type { AnimationName, MotionState } from './animation';

/**
 * What the game needs from a player's body: something to put in the scene and
 * a way to pose it from motion. The procedural placeholder and the glTF human
 * both implement it, so the rest of the client does not care which is loaded.
 * Pattern: Strategy — Why: swapping the character model is one factory change.
 */
export interface CharacterRig {
  readonly object: Object3D;
  /** Clip currently chosen (debugging and tests). */
  readonly animation: AnimationName;
  update(motion: MotionState, dtSeconds: number): void;
}

/** Builds a body for a player; `seed` picks the outfit/skin so players look different. */
export type CharacterFactory = (seed: number) => CharacterRig;
