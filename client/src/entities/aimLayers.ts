import { AnimationClip, type KeyframeTrack } from 'three';

/** Bones that carry the aim: spine up, shoulders, arms, hands, neck and head. Everything else is legs and hips. */
const UPPER_BODY =
  /^(spine_0[1-3]|neck_01|Head|clavicle_[lr]|upperarm_[lr]|lowerarm_[lr]|hand_[lr])$/;

/** Track names look like "upperarm_l.quaternion"; the bone is everything before the last dot. */
const boneOf = (track: KeyframeTrack): string => track.name.slice(0, track.name.lastIndexOf('.'));

export const isUpperBodyTrack = (track: KeyframeTrack): boolean => UPPER_BODY.test(boneOf(track));

/**
 * Splits a clip in two by body part, so the legs can keep walking while the
 * arms and torso aim. Two actions on one skeleton then blend per bone:
 * "lower" from locomotion, "upper" from the aiming clip.
 * Pattern: Layered animation (animation masks) — Why: a soldier runs and aims
 * at once; without layers every aim-while-moving pose would need its own clip.
 */
export function splitClip(clip: AnimationClip): { upper: AnimationClip; lower: AnimationClip } {
  const upper = clip.tracks.filter(isUpperBodyTrack);
  const lower = clip.tracks.filter((t) => !isUpperBodyTrack(t));
  return {
    upper: new AnimationClip(`${clip.name}:upper`, clip.duration, upper),
    lower: new AnimationClip(`${clip.name}:lower`, clip.duration, lower),
  };
}
