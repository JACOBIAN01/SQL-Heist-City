import { TUTORIAL_STEPS, TUTORIAL_TARGETS, type LootSpot } from '@heist/shared';
import { h } from '../ui/dom';
import './tutorial.css';

/** Remembered once the tutorial is finished, so the page stops suggesting it. */
export const TUTORIAL_DONE_KEY = 'heist:tutorialDone';

/** Storage that may be missing or refuse (private windows, blocked site data). */
type MaybeStorage = Pick<Storage, 'getItem' | 'setItem'> | undefined;

function remember(storage: MaybeStorage): void {
  try {
    storage?.setItem(TUTORIAL_DONE_KEY, '1');
  } catch {
    // Not remembered: the invitation shows again next time, nothing worse.
  }
}

/** Whether to suggest the tutorial: until it has been finished once in this browser. */
export function shouldInvite(storage: MaybeStorage): boolean {
  try {
    return storage?.getItem(TUTORIAL_DONE_KEY) !== '1';
  } catch {
    return true;
  }
}

/** The page's query string for a real match after the tutorial (same server, no tutorial map). */
export function realMatchSearch(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('tutorial');
  params.delete('map');
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/** A link suggesting the tutorial to someone who has not finished it (undefined once they have). */
export function tutorialInvite(
  parent: HTMLElement,
  storage: MaybeStorage,
): HTMLElement | undefined {
  if (!shouldInvite(storage)) return undefined;
  const link = h('a', {
    class: 'tut-invite',
    text: 'New here? Play the tutorial',
    attrs: { href: '?tutorial' },
  });
  parent.append(link);
  return link;
}

/** Where step `step` happens (for the beacon and the minimap), if it happens somewhere. */
export function tutorialTarget(step: number): LootSpot | undefined {
  const id = TUTORIAL_STEPS[step]?.id;
  return id ? TUTORIAL_TARGETS[id] : undefined;
}

/**
 * The tutorial card: the step the server says the player is on, what to do,
 * and the list of steps with the done ones ticked. At the end it offers a
 * real match.
 */
export class TutorialGuide {
  readonly root: HTMLElement;
  private readonly count: HTMLElement;
  private readonly title: HTMLElement;
  private readonly text: HTMLElement;
  private readonly items: HTMLElement[];
  private readonly finish: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly options: { readonly onPlay: () => void; readonly storage?: MaybeStorage },
  ) {
    this.count = h('div', { class: 'tut-count' });
    this.title = h('div', { class: 'tut-title' });
    this.text = h('div', { class: 'tut-text' });
    this.items = TUTORIAL_STEPS.map((s) => h('li', { text: s.title }));
    this.finish = h('button', {
      class: 'tut-play',
      text: 'Play a real match',
      on: { click: () => this.options.onPlay() },
    });
    this.finish.hidden = true;
    this.root = h(
      'aside',
      { class: 'tut', attrs: { 'aria-live': 'polite' } },
      this.count,
      this.title,
      this.text,
      h('ol', { class: 'tut-steps' }, ...this.items),
      this.finish,
    );
    parent.append(this.root);
    this.show(0);
  }

  /** Shows step `step` (TUTORIAL_STEPS.length: all done). */
  show(step: number): void {
    const total = TUTORIAL_STEPS.length;
    const done = step >= total;
    this.items.forEach((li, i) => {
      li.className = i < step ? 'done' : i === step ? 'current' : '';
    });
    this.finish.hidden = !done;
    this.root.classList.toggle('tut-finished', done);
    if (done) {
      remember(this.options.storage);
      this.count.textContent = 'Tutorial complete';
      this.title.textContent = 'You are ready';
      this.text.textContent =
        'That is the whole heist: every action is a SQL question, and cash only counts once it is banked. In a real match up to 100 players want the same vaults.';
      return;
    }
    const current = TUTORIAL_STEPS[step];
    this.count.textContent = `Tutorial · step ${step + 1} of ${total}`;
    this.title.textContent = current?.title ?? '';
    this.text.textContent = current?.text ?? '';
  }

  destroy(): void {
    this.root.remove();
  }
}
