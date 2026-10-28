import { describe, expect, it, vi } from 'vitest';
import type { CheatOutcome } from '@heist/shared';
import { I18n } from '../../i18n/I18n';
import { CheatPrompt } from './CheatPrompt';

const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(answer: CheatOutcome | 'no_task') {
  const submit = vi.fn(async (_code: string) => answer);
  const prompt = new CheatPrompt(new I18n('en'), submit);
  document.body.append(prompt.root);
  const input = prompt.root.querySelector('input') as HTMLInputElement;
  const type = async (code: string) => {
    input.value = code;
    prompt.root.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  };
  return {
    prompt,
    submit,
    input,
    type,
    note: () => prompt.root.querySelector('.cheat-note')?.textContent,
  };
}

describe('CheatPrompt', () => {
  it('is hidden until opened, hides a typed code, and clears it after sending', async () => {
    const s = setup({ ok: false, reason: 'wrong' });
    expect(s.prompt.isOpen).toBe(false);
    s.prompt.open();
    expect(s.prompt.isOpen).toBe(true);
    expect(s.input.type).toBe('password');
    await s.type('secret-1');
    expect(s.submit).toHaveBeenCalledWith('secret-1');
    expect(s.input.value).toBe('');
    expect(s.note()).toBe('No.');
  });
  it('closes when the code passes', async () => {
    const s = setup({ ok: true, rewardKey: 'heal:small', target: null });
    s.prompt.open();
    await s.type('right');
    expect(s.prompt.isOpen).toBe(false);
  });
  it('says how long to wait when locked out, and asks for a question when none is open', async () => {
    const locked = setup({ ok: false, reason: 'locked', lockedUntil: 1 });
    locked.prompt.open();
    await locked.type('x');
    expect(locked.note()).toBe('Too many tries. Wait a while.');
    const none = setup('no_task');
    none.prompt.open();
    await none.type('x');
    expect(none.note()).toBe('Open a question first.');
  });
  it('sends nothing for an empty box, and closes on Escape without letting keys reach the game', () => {
    const s = setup({ ok: false, reason: 'wrong' });
    s.prompt.open();
    s.prompt.root.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(s.submit).not.toHaveBeenCalled();
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    s.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    expect(outer).not.toHaveBeenCalled();
    s.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(s.prompt.isOpen).toBe(false);
    window.removeEventListener('keydown', outer);
  });
});
