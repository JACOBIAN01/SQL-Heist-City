import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { I18n } from '../i18n/I18n';
import { KillCamView } from './KillCamView';

const msg = { t: 'killcam' as const, killer: { id: 7, name: 'Ben' }, seconds: 3.5 };

describe('KillCamView', () => {
  it('says who it was, and how long their last answer took when it knows', () => {
    const v = new KillCamView(new I18n('en'));
    expect(v.root.hidden).toBe(true);
    v.start({ ...msg, lastAnswer: { seconds: 42, rewardKey: 'vault:bank-1:lock-1' } }, 0);
    expect(v.root.hidden).toBe(false);
    expect(v.root.textContent).toBe('Put down by Ben. Their last answer took 42 s.');
    v.start(msg, 0);
    expect(v.root.textContent).toBe('Put down by Ben.');
  });

  it('is active for the length of the shot, then goes quiet', () => {
    const v = new KillCamView(new I18n('en'));
    expect(v.active(0)).toBe(false);
    v.start(msg, 1000);
    expect(v.killerId).toBe(7);
    expect(v.active(4000)).toBe(true);
    expect(v.active(4600)).toBe(false);
    v.frame(4600, false);
    expect(v.root.hidden).toBe(true);
  });

  it('ends at once when the player is up again', () => {
    const v = new KillCamView(new I18n('en'));
    v.start(msg, 0);
    v.frame(500, true);
    expect(v.root.hidden).toBe(true);
    expect(v.active(500)).toBe(false);
  });

  it('puts the camera at the killer’s eyes, looking at the player they put down', () => {
    const v = new KillCamView(new I18n('en'));
    const camera = new PerspectiveCamera();
    v.place(camera, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(camera.position.toArray()).toEqual([10, 1.6, 0]);
    const look = camera.getWorldDirection(camera.position.clone());
    expect(look.x).toBeLessThan(-0.9); // towards -x, where the victim is
  });
});
