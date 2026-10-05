import { describe, expect, it } from 'vitest';
import { audioSettingsSchema, DEFAULT_AUDIO_SETTINGS, strideAt } from './audio';

describe('audio settings', () => {
  it('lets gunshots carry far further than footsteps', () => {
    const s = DEFAULT_AUDIO_SETTINGS;
    expect(s.shotRange).toBeGreaterThan(s.footstepRange * 4);
    expect(s.footstepRange).toBeGreaterThan(s.refDistance);
  });

  it('takes longer strides the faster a body goes', () => {
    const s = DEFAULT_AUDIO_SETTINGS;
    // About three steps a second at a jog (4 m/s), four sprinting (7 m/s).
    expect(4 / strideAt(4, s)).toBeCloseTo(3, 0);
    expect(7 / strideAt(7, s)).toBeCloseTo(4, 0);
  });

  it('rejects impossible settings', () => {
    expect(() => audioSettingsSchema.parse({ volume: 2 })).toThrow();
    expect(() => audioSettingsSchema.parse({ echoFeedback: 1 })).toThrow();
    expect(() => audioSettingsSchema.parse({ maxVoices: 0 })).toThrow();
  });
});
