import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO_SETTINGS } from '@heist/shared';
import { FakeAudioContext, type FakeNode } from '../testing/FakeAudioContext';
import { AudioEngine, distanceGain } from './AudioEngine';
import { SynthSoundBank } from './SoundBank';

const s = DEFAULT_AUDIO_SETTINGS;

function setup(settings = s) {
  const ctx = new FakeAudioContext();
  const bank = new SynthSoundBank(ctx, ['step-concrete', 'shot-pistol', 'engine', 'wind']);
  const engine = new AudioEngine(ctx.asContext(), bank, settings);
  engine.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  return { ctx, engine };
}

describe('distanceGain', () => {
  it('is full volume up close and fades with distance', () => {
    expect(distanceGain(0, s)).toBe(1);
    expect(distanceGain(s.refDistance, s)).toBe(1);
    expect(distanceGain(30, s)).toBeLessThan(distanceGain(10, s));
    expect(distanceGain(200, s)).toBeGreaterThan(0);
  });
});

describe('AudioEngine', () => {
  it('plays a sound where it happens, through a panner, to the speakers', () => {
    const { ctx, engine } = setup();
    engine.play('step-concrete', { at: { x: 5, y: 0, z: 2 }, range: 30 });
    const [source] = ctx.playing;
    expect(source).toBeDefined();
    const panner = ctx.panners[0];
    expect([panner?.positionX.value, panner?.positionZ.value]).toEqual([5, 2]);
    expect(source?.reaches(ctx.destination)).toBe(true);
    expect(source?.reaches(panner as FakeNode)).toBe(true);
  });

  it('plays sounds without a place in the listener’s head (no panner)', () => {
    const { ctx, engine } = setup();
    engine.play('shot-pistol');
    expect(ctx.playing).toHaveLength(1);
    expect(ctx.panners).toHaveLength(0);
  });

  it('does not play what is out of earshot', () => {
    const { ctx, engine } = setup();
    engine.play('step-concrete', { at: { x: 40, y: 0, z: 0 }, range: 30 });
    expect(ctx.sources).toHaveLength(0);
  });

  it('sends gunshots into the echo, footsteps not', () => {
    const { ctx, engine } = setup();
    engine.play('shot-pistol', { at: { x: 10, y: 0, z: 0 }, echo: true });
    engine.play('step-concrete', { at: { x: 2, y: 0, z: 0 } });
    const [shot, step] = ctx.sources;
    const delayReached = (n: FakeNode | undefined): boolean => {
      const seen = new Set<FakeNode>();
      const walk = (node: FakeNode): boolean =>
        node.kind === 'delay' ||
        (!seen.has(node) && (seen.add(node), node.outputs.some((o) => walk(o))));
      return n ? walk(n) : false;
    };
    expect(delayReached(shot)).toBe(true);
    expect(delayReached(step)).toBe(false);
  });

  it('keeps to the voice limit: louder sounds push out the quietest, quieter ones are dropped', () => {
    const { ctx, engine } = setup({ ...s, maxVoices: 3 });
    for (const x of [20, 10, 5]) engine.play('step-concrete', { at: { x, y: 0, z: 0 } });
    expect(ctx.playing).toHaveLength(3);
    engine.play('step-concrete', { at: { x: 25, y: 0, z: 0 } }); // quieter than all: dropped
    expect(ctx.sources).toHaveLength(3);
    engine.play('shot-pistol'); // in your own hands: loudest
    expect(ctx.playing).toHaveLength(3);
    expect(ctx.sources[0]?.stoppedAt).toBeDefined(); // the one 20 m away made room
    // Finished sounds free their voice.
    ctx.currentTime = 10;
    engine.play('step-concrete', { at: { x: 25, y: 0, z: 0 } });
    expect(ctx.sources).toHaveLength(5);
  });

  it('loops until stopped, and can be moved, re-pitched and faded', () => {
    const { ctx, engine } = setup();
    const loop = engine.loop('engine', { at: { x: 3, y: 0, z: 0 } });
    const source = ctx.sources[0];
    expect(source?.loop).toBe(true);
    loop?.move({ x: 8, y: 0, z: 1 });
    expect(ctx.panners[0]?.positionX.value).toBe(8);
    loop?.setRate(1.8);
    expect(source?.playbackRate.value).toBe(1.8);
    loop?.stop();
    loop?.stop();
    expect(source?.stoppedAt).toBeGreaterThan(0); // after a short fade
  });

  it('mutes and unmutes everything', () => {
    const { engine } = setup();
    engine.setMuted(true);
    expect(engine.muted).toBe(true);
    engine.setMuted(false);
    expect(engine.muted).toBe(false);
  });

  it('follows the camera as the listener', () => {
    const { ctx, engine } = setup();
    engine.setListener({ x: 1, y: 2, z: 3 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(ctx.listener.positionY.value).toBe(2);
    expect(ctx.listener.forwardX.value).toBe(1);
  });
});
