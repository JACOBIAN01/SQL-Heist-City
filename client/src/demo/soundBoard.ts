import { DEFAULT_AUDIO_SETTINGS } from '@heist/shared';
import { AudioEngine, type LoopHandle } from '../audio/AudioEngine';
import { SynthSoundBank } from '../audio/SoundBank';
import { LOOPS, SOUND_NAMES } from '../audio/synth';

// Standalone page (sounds.html): play each generated sound, near or far, to judge it by ear
// and to compare it with a recording that might replace it.
const grid = document.getElementById('sounds') as HTMLElement;
const distance = document.getElementById('distance') as HTMLInputElement;
const metres = document.getElementById('metres') as HTMLElement;
let engine: AudioEngine | undefined;
const loops = new Map<string, LoopHandle>();

const ear = () => {
  if (!engine) {
    const ctx = new AudioContext();
    engine = new AudioEngine(ctx, new SynthSoundBank(ctx), DEFAULT_AUDIO_SETTINGS);
    engine.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  }
  return engine;
};
// In front of you, `distance` metres away.
const at = () => ({ x: 0, y: 0, z: -Number(distance.value) });

distance.addEventListener('input', () => {
  metres.textContent = `${distance.value} m`;
  for (const loop of loops.values()) loop.move(at());
});

for (const name of SOUND_NAMES) {
  const button = document.createElement('button');
  button.textContent = name;
  button.addEventListener('click', () => {
    const out = ear();
    if (!LOOPS.has(name)) {
      out.play(name, { at: at(), echo: name.startsWith('shot-') });
      return;
    }
    const playing = loops.get(name);
    if (playing) {
      playing.stop();
      loops.delete(name);
    } else {
      const loop = out.loop(name, { at: at() });
      if (loop) loops.set(name, loop);
    }
    button.setAttribute('aria-pressed', String(!playing));
  });
  grid.appendChild(button);
}
