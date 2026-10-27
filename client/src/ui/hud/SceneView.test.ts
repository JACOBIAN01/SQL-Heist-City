import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SceneMessage } from '@heist/shared';
import { I18n } from '../../i18n/I18n';
import { BarkView, SceneView } from './SceneView';

afterEach(() => document.body.replaceChildren());

const scene = (id: string, lines: [string, string][]): SceneMessage => ({
  t: 'scene',
  id,
  title: `Scene ${id}`,
  lines: lines.map(([speaker, text]) => ({ speaker, text })),
});

describe('SceneView', () => {
  it('plays the lines in turn and ends after the last', () => {
    const hooks = { onStart: vi.fn(), onEnd: vi.fn() };
    const v = new SceneView(new I18n('en'), hooks);
    document.body.append(v.root);
    expect(v.root.hidden).toBe(true);
    v.play(
      scene('a', [
        ['Mae', 'First.'],
        ['Mae', 'Second.'],
      ]),
    );
    expect(v.root.hidden).toBe(false);
    expect(v.root.textContent).toContain('First.');
    expect(hooks.onStart).toHaveBeenCalledTimes(1);
    v.advance();
    expect(v.root.textContent).toContain('Second.');
    v.advance();
    expect(v.root.hidden).toBe(true);
    expect(hooks.onEnd).toHaveBeenCalledTimes(1);
  });

  it('can be skipped at once, and plays the scene waiting behind it', () => {
    const hooks = { onStart: vi.fn(), onEnd: vi.fn() };
    const v = new SceneView(new I18n('en'), hooks);
    v.play(
      scene('a', [
        ['Mae', 'One.'],
        ['Mae', 'Two.'],
      ]),
    );
    v.play(scene('b', [['Dev', 'Next scene.']]));
    expect(v.playing).toBe(true);
    v.root.querySelector<HTMLButtonElement>('[data-action="skip"]')?.click();
    expect(v.root.textContent).toContain('Next scene.');
    expect(hooks.onStart).toHaveBeenCalledTimes(1); // the pointer is released once, for both
    expect(hooks.onEnd).not.toHaveBeenCalled();
    v.skip();
    expect(v.playing).toBe(false);
    expect(hooks.onEnd).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is no scene', () => {
    const v = new SceneView(new I18n('en'));
    v.advance();
    v.skip();
    expect(v.playing).toBe(false);
  });
});

describe('BarkView', () => {
  it('shows a line for a few seconds, then goes', () => {
    const b = new BarkView();
    b.show('Mae', 'Good.', 0);
    expect(b.root.hidden).toBe(false);
    expect(b.root.textContent).toBe('Mae: Good.');
    b.frame(7000);
    expect(b.root.hidden).toBe(true);
  });
});
