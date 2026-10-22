import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18n } from '../../i18n/I18n';
import { ShareCardView, type ShareEnv } from './ShareCardView';

afterEach(() => vi.restoreAllMocks());

const input = {
  name: 'Ana',
  round: 3,
  banked: 1000,
  kills: 1,
  awards: [],
  items: [],
};
const opts = { enabled: true, showQuery: true, maxQueryLines: 8 };

/** jsdom has no canvas: give it a context that records, and a toBlob that makes a small blob. */
function fakeCanvas(view: ShareCardView) {
  const canvas = view.root.querySelector('canvas') as HTMLCanvasElement;
  const drawn: string[] = [];
  const ctx = {
    font: '',
    fillStyle: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: () => {},
    fillText: (t: string) => void drawn.push(t),
    measureText: (t: string) => ({ width: t.length * 10 }),
  };
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as never);
  vi.spyOn(canvas, 'toBlob').mockImplementation((cb) =>
    cb(new Blob(['png'], { type: 'image/png' })),
  );
  return drawn;
}

describe('ShareCardView', () => {
  it('waits for the round, then draws the card and offers to save it', async () => {
    const saved: { name: string; size: number }[] = [];
    const env: ShareEnv = { save: (name, blob) => void saved.push({ name, size: blob.size }) };
    const view = new ShareCardView(new I18n('en'), env);
    expect(view.root.textContent).toContain('appears when the round ends');
    expect((view.root.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    const drawn = fakeCanvas(view);
    view.update(input, opts);
    expect(drawn).toContain('Ana');
    const save = [...view.root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save image',
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await view.save();
    expect(saved).toEqual([{ name: 'sql-heist-round-3.png', size: 3 }]);
    // No share sheet on this device: no Share button.
    expect([...view.root.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Save image',
    ]);
  });

  it('offers the share sheet when the device has one', async () => {
    const shared: { name: string; title: string }[] = [];
    const env: ShareEnv = {
      save: () => {},
      share: async (file, title) => void shared.push({ name: file.name, title }),
    };
    const view = new ShareCardView(new I18n('en'), env);
    fakeCanvas(view);
    view.update(input, opts);
    const button = [...view.root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Share…',
    ) as HTMLButtonElement;
    button.click();
    await vi.waitFor(() =>
      expect(shared).toEqual([{ name: 'sql-heist-round-3.png', title: 'Round card' }]),
    );
  });

  it('hides itself when the school has switched cards off', () => {
    const view = new ShareCardView(new I18n('en'), { save: () => {} });
    fakeCanvas(view);
    view.update(input, { ...opts, enabled: false });
    expect(view.root.hidden).toBe(true);
    view.update(input, opts);
    expect(view.root.hidden).toBe(false);
  });

  it('passes the structural accessibility check', async () => {
    document.body.append(new ShareCardView(new I18n('en'), { save: () => {} }).root);
    const r = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(r.violations.map((v) => v.id)).toEqual([]);
    document.body.replaceChildren();
  });
});
