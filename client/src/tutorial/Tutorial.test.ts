import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TUTORIAL_STEPS, TUTORIAL_TARGETS } from '@heist/shared';
import { TutorialBeacon } from './TutorialBeacon';
import {
  TUTORIAL_DONE_KEY,
  TutorialGuide,
  realMatchSearch,
  shouldInvite,
  tutorialInvite,
  tutorialTarget,
} from './TutorialGuide';

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

describe('TutorialGuide', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
  });
  afterEach(() => host.remove());

  const q = (sel: string) => host.querySelector(sel) as HTMLElement;

  it('shows the current step and ticks the ones before it', () => {
    const guide = new TutorialGuide(host, { onPlay: vi.fn() });
    guide.show(2);
    expect(q('.tut-count').textContent).toBe(`Tutorial · step 3 of ${TUTORIAL_STEPS.length}`);
    expect(q('.tut-title').textContent).toBe(TUTORIAL_STEPS[2]?.title);
    expect(q('.tut-text').textContent).toBe(TUTORIAL_STEPS[2]?.text);
    const items = [...host.querySelectorAll('.tut-steps li')].map((li) => li.className);
    expect(items.slice(0, 3)).toEqual(['done', 'done', 'current']);
    expect((q('.tut-play') as HTMLButtonElement).hidden).toBe(true);
  });

  it('offers a real match at the end, and remembers the tutorial was done', () => {
    const onPlay = vi.fn();
    const storage = memory();
    const guide = new TutorialGuide(host, { onPlay, storage });
    expect(shouldInvite(storage)).toBe(true);
    guide.show(TUTORIAL_STEPS.length);
    expect(q('.tut-count').textContent).toBe('Tutorial complete');
    const play = q('.tut-play') as HTMLButtonElement;
    expect(play.hidden).toBe(false);
    play.click();
    expect(onPlay).toHaveBeenCalledOnce();
    expect(storage.getItem(TUTORIAL_DONE_KEY)).toBe('1');
    expect(shouldInvite(storage)).toBe(false);
  });

  it('still works when storage refuses', () => {
    const refusing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const guide = new TutorialGuide(host, { onPlay: vi.fn(), storage: refusing });
    expect(() => guide.show(TUTORIAL_STEPS.length)).not.toThrow();
    expect(shouldInvite(refusing)).toBe(true);
  });
});

describe('getting to and from the tutorial', () => {
  it('invites a newcomer until they have finished it', () => {
    const storage = memory();
    const host = document.createElement('div');
    expect(tutorialInvite(host, storage)?.getAttribute('href')).toBe('?tutorial');
    storage.setItem(TUTORIAL_DONE_KEY, '1');
    expect(tutorialInvite(host, storage)).toBeUndefined();
  });

  it('leaves for a real match on the same server', () => {
    expect(realMatchSearch('?tutorial&server=8090&name=Ana')).toBe('?server=8090&name=Ana');
    expect(realMatchSearch('?tutorial')).toBe('');
    expect(realMatchSearch('?map=tutorial&tutorial=')).toBe('');
  });
});

describe('tutorialTarget', () => {
  it('points at where a step happens, and nowhere for steps done anywhere', () => {
    expect(tutorialTarget(0)).toBe(TUTORIAL_TARGETS.move);
    expect(tutorialTarget(TUTORIAL_STEPS.findIndex((s) => s.id === 'heal'))).toBeUndefined();
    expect(tutorialTarget(TUTORIAL_STEPS.length)).toBeUndefined();
  });
});

describe('TutorialBeacon', () => {
  it('stands at the target, and hides when there is none', () => {
    const beacon = new TutorialBeacon();
    expect(beacon.object.visible).toBe(false);
    beacon.setTarget({ x: 3, y: 6, z: -4 });
    expect(beacon.object.visible).toBe(true);
    expect(beacon.object.position.toArray()).toEqual([3, 6, -4]);
    beacon.update(1.2);
    beacon.setTarget(undefined);
    expect(beacon.object.visible).toBe(false);
  });
});
