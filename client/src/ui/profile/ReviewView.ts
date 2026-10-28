import type { ReviewItem, ReviewMessage } from '@heist/shared';
import { clear, h } from '../dom';
import './profile.css';

const OUTCOMES: Readonly<Record<string, string>> = {
  solved: 'Solved',
  expired: 'Ran out of time',
  abandoned: 'Closed',
  switched: 'Switched to another task',
  died: 'You were shot',
  left: 'Left',
  cheat: 'Passed with the cheat code',
};

/**
 * The round review: every question you met, what you wrote, the model answer
 * and the concept cards for its topics. It arrives only after the round has
 * ended. Everything is drawn as text, never markup.
 */
export class ReviewView {
  readonly root = h('section', { class: 'profile review', attrs: { 'data-role': 'review' } });
  private latest: ReviewMessage | undefined;

  update(message: ReviewMessage): void {
    this.latest = message;
    this.draw();
  }

  get hasReview(): boolean {
    return (this.latest?.items.length ?? 0) > 0;
  }

  private draw(): void {
    clear(this.root);
    const m = this.latest;
    this.root.appendChild(h('h2', { text: m ? `Round ${m.round} review` : 'Round review' }));
    if (!m || m.items.length === 0) {
      this.root.appendChild(
        h('p', {
          class: 'profile-note',
          text: 'No questions to review yet. Review opens after a round.',
        }),
      );
      return;
    }
    this.root.appendChild(
      h('p', {
        class: 'profile-note',
        text: `${m.items.length} question${m.items.length === 1 ? '' : 's'} this round. Compare your query with the model answer.`,
      }),
    );
    for (const item of m.items) this.root.appendChild(this.card(item));
  }

  private card(i: ReviewItem): HTMLElement {
    const facts = [
      OUTCOMES[i.outcome] ?? i.outcome,
      `${i.secondsOpen} s`,
      i.hintsUsed > 0 ? `${i.hintsUsed} paid hint${i.hintsUsed === 1 ? '' : 's'}` : null,
      i.topics.join(', '),
    ].filter(Boolean);
    return h(
      'article',
      { class: `review-item ${i.outcome === 'solved' ? 'solved' : 'missed'}` },
      h('h3', { text: i.title }),
      h('p', { class: 'profile-note', text: facts.join(' · ') }),
      h('p', { class: 'review-story', text: i.story }),
      h(
        'div',
        { class: 'review-sql' },
        h('strong', { text: 'Your last query' }),
        h('pre', { text: i.yourSql ?? '(you did not run a query)' }),
      ),
      h(
        'div',
        { class: 'review-sql' },
        h('strong', { text: 'Model answer' }),
        h('pre', { text: i.modelSql }),
      ),
      ...i.cards.map((c) =>
        h(
          'details',
          {},
          h('summary', { text: `Concept: ${c.title}` }),
          h('p', { text: c.body_md }),
        ),
      ),
    );
  }
}
