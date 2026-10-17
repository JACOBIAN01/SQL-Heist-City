import { describe, expect, it } from 'vitest';
import { CaptionView } from './CaptionView';

describe('CaptionView (22.3)', () => {
  it('shows the latest captions, drops old ones, and is a polite live region', () => {
    let t = 0;
    const view = new CaptionView(document.body, () => t, 1000, 3);
    expect(view.root.getAttribute('role')).toBe('log');
    expect(view.root.getAttribute('aria-live')).toBe('polite');
    for (const text of ['A', 'B', 'C', 'D']) view.show({ text });
    expect([...view.root.children].map((c) => c.textContent)).toEqual(['[B]', '[C]', '[D]']);
    view.show({ text: 'Alarm', bearing: 'left', metres: 25 });
    expect(view.root.lastElementChild?.textContent).toBe('[Alarm] ← 25 m');
    t = 1500;
    view.tick();
    expect(view.root.children).toHaveLength(0);
    view.root.remove();
  });
});
