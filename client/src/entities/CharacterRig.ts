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
  /** Puts an object in the right hand (a gun), replacing what was there; undefined empties the hand. */
  holdItem(item: Object3D | undefined): void;
  /** This player just fired: a soldier draws, aims and kicks (rigs without the animation ignore it). */
  fired(): void;
  /** Shows or hides the cash bag this player carries. */
  setCarrying(carrying: boolean): void;
  /** Where the player aims up or down (radians, positive up), so a drawn gun points there. */
  setAimPitch(pitch: number): void;
  update(motion: MotionState, dtSeconds: number): void;
}

/** Builds a body for a player; `seed` picks the outfit/skin so players look different. */
export type CharacterFactory = (seed: number) => CharacterRig;
