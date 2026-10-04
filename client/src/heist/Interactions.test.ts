import { describe, expect, it, vi } from 'vitest';
import { HEIST_MAP, type JsonClientMessage } from '@heist/shared';
import { Interactions, type InteractionsView } from './Interactions';

function setup() {
  const sent: JsonClientMessage[] = [];
  const prompts: (string | undefined)[] = [];
  const toasts: string[] = [];
  const tasks: [string, string][] = [];
  const view: InteractionsView = {
    setPrompt: (t) => prompts.push(t),
    toast: (t) => toasts.push(t),
  };
  const interactions = new Interactions({
    map: HEIST_MAP,
    send: (m) => sent.push(m),
    view,
    onOpenTask: (key, target) => tasks.push([key, target]),
  });
  return { interactions, sent, prompts, toasts, tasks };
}

describe('Interactions', () => {
  it('offers the nearest anchor and withdraws it when the player walks away', () => {
    const { interactions, prompts } = setup();
    interactions.update(9.5, 0, 5, true);
    interactions.update(9.4, 0, 5, true); // same anchor: no flicker
    interactions.update(-30, 0, -30, true);
    expect(prompts).toEqual(['F — Take the lift', undefined]);
  });

  it('offers nothing while the player cannot act (dead, typing a query)', () => {
    const { interactions, prompts } = setup();
    interactions.update(9.5, 0, 5, false);
    expect(prompts).toEqual([]);
  });

  it('sends an interact for the anchor in reach and reports where the lift went', async () => {
    const { interactions, sent, toasts } = setup();
    interactions.update(9.5, 0, 5, true);
    const used = interactions.use();
    expect(sent).toEqual([{ t: 'interact', ref: 1, anchor: 'bank-1:lift:0' }]);
    interactions.handle({
      t: 'interact_result',
      ref: 1,
      anchor: 'bank-1:lift:0',
      result: { action: 'moved', storey: 1 },
    });
    await used;
    expect(toasts).toEqual(['Floor 1']);
  });

  it('explains a refusal in words', async () => {
    const { interactions, toasts } = setup();
    interactions.update(9.5, 0, 5, true);
    const used = interactions.use();
    interactions.handle({
      t: 'interact_result',
      ref: 1,
      anchor: 'bank-1:lift:0',
      result: { action: 'denied', reason: 'too_far' },
    });
    await used;
    expect(toasts).toEqual(['Too far away']);
  });

  it('opens the SQL panel when the server says the use starts a task', async () => {
    const { interactions, tasks } = setup();
    interactions.update(9.5, 0, 5, true);
    const used = interactions.use();
    interactions.handle({
      t: 'interact_result',
      ref: 1,
      anchor: 'bank-1:lift:0',
      result: { action: 'open_task', rewardKey: 'vault:bank-1:lock-1', target: 'bank-1' },
    });
    await used;
    expect(tasks).toEqual([['vault:bank-1:lock-1', 'bank-1']]);
  });

  it('does nothing without an anchor, and ignores a second press while one is pending', async () => {
    const { interactions, sent } = setup();
    await interactions.use();
    expect(sent).toEqual([]);
    interactions.update(9.5, 0, 5, true);
    void interactions.use();
    void interactions.use();
    expect(sent).toHaveLength(1);
  });

  it('tells the player when the server never answers', async () => {
    vi.useFakeTimers();
    const { interactions, toasts } = setup();
    interactions.update(9.5, 0, 5, true);
    const used = interactions.use();
    await vi.advanceTimersByTimeAsync(5_100);
    await used;
    expect(toasts).toEqual(['No answer from the server']);
    vi.useRealTimers();
  });

  it('keeps quiet when banking starts: the progress bar comes from the banking messages', async () => {
    const { interactions, toasts } = setup();
    interactions.update(9.5, 0, 5, true);
    const used = interactions.use();
    interactions.handle({
      t: 'interact_result',
      ref: 1,
      anchor: 'bank-1:lift:0',
      result: { action: 'banking', seconds: 4 },
    });
    await used;
    expect(toasts).toEqual([]);
  });

  it('ignores other messages', () => {
    const { interactions } = setup();
    expect(interactions.handle({ t: 'challenge_abandoned', ref: 1, now: 0 })).toBe(false);
  });
});
