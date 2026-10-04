import { describe, expect, it } from 'vitest';
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { isUpperBodyTrack, splitClip } from './aimLayers';

const q = (bone: string) =>
  new QuaternionKeyframeTrack(`${bone}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);

describe('splitClip', () => {
  const clip = new AnimationClip('Walk_Loop', 1, [
    q('thigh_l'),
    q('calf_r'),
    q('pelvis'),
    q('spine_02'),
    q('upperarm_r'),
    q('hand_l'),
    q('Head'),
    new VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0, 1]),
  ]);

  it('puts the torso, arms and head in the upper layer and legs and hips in the lower', () => {
    const { upper, lower } = splitClip(clip);
    expect(upper.tracks.map((t) => t.name)).toEqual([
      'spine_02.quaternion',
      'upperarm_r.quaternion',
      'hand_l.quaternion',
      'Head.quaternion',
    ]);
    expect(lower.tracks.map((t) => t.name)).toEqual([
      'thigh_l.quaternion',
      'calf_r.quaternion',
      'pelvis.quaternion',
      'root.position',
    ]);
  });

  it('keeps every track exactly once, and the duration', () => {
    const { upper, lower } = splitClip(clip);
    expect(upper.tracks.length + lower.tracks.length).toBe(clip.tracks.length);
    expect(upper.duration).toBe(1);
    expect(lower.name).toBe('Walk_Loop:lower');
  });

  it('does not mistake a bone whose name merely starts like an upper one', () => {
    expect(isUpperBodyTrack(q('spine_04'))).toBe(false);
    expect(isUpperBodyTrack(q('upperarm_twist_l'))).toBe(false);
    expect(isUpperBodyTrack(q('hand_r'))).toBe(true);
  });
});
