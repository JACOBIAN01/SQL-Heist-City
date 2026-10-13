import {
  axisLine,
  focusText,
  lensAxes,
  radarModel,
  scoreValues,
  type Lens,
  type ProfileMessage,
  type ProfileScopeView,
} from '@heist/shared';
import { clear, h } from '../dom';
import { drawRadar } from './RadarChart';
import './profile.css';

export type ProfileMode = 'all' | 'round';

/**
 * A student's own profile as two live radars (RCSBE and Bloom), with the same
 * numbers in words underneath for anyone who cannot read a chart. `all` shows
 * everything so far (with this class over it, in a class); `round` shows this
 * round over everything so far. Only ever the receiving student's own data.
 */
export class ProfileView {
  readonly root = h('section', { class: 'profile', attrs: { 'data-role': 'profile' } });
  private latest: ProfileMessage | undefined;

  constructor(private readonly mode: ProfileMode) {}

  update(message: ProfileMessage): void {
    this.latest = message;
    this.draw();
  }

  private draw(): void {
    clear(this.root);
    const m = this.latest;
    const title = this.mode === 'round' ? 'This round' : 'Your profile';
    this.root.appendChild(h('h2', { text: title }));
    if (!m) {
      this.root.appendChild(
        h('p', { class: 'profile-note', text: 'Answer a question to start your profile.' }),
      );
      return;
    }
    const primary = this.mode === 'round' ? m.round : (m.class ?? m.all);
    const compare = this.mode === 'round' ? m.all : m.class ? m.all : undefined;
    const primaryName = this.mode === 'round' ? 'This round' : m.class ? 'This class' : 'All time';
    const compareName = this.mode === 'round' ? 'All time' : 'All time';
    if (!primary) {
      this.root.appendChild(
        h('p', { class: 'profile-note', text: 'No questions answered this round yet.' }),
      );
      return;
    }
    const grid = h('div', { class: 'profile-radars' });
    for (const lens of ['rcsbe', 'bloom'] as const)
      grid.appendChild(this.lensCard(lens, primary, compare, primaryName, compareName, m.moved));
    this.root.appendChild(grid);
    if (primary.focus) {
      this.root.appendChild(
        h('p', {
          class: 'profile-focus',
          text: focusText(primary.focus.lens, primary.focus.dimension),
        }),
      );
    }
  }

  private lensCard(
    lens: Lens,
    primary: ProfileScopeView,
    compare: ProfileScopeView | undefined,
    primaryName: string,
    compareName: string,
    moved: ProfileMessage['moved'],
  ): HTMLElement {
    const scores = primary[lens];
    const layers = [
      { id: primaryName, kind: 'fill' as const, values: scoreValues(scores) },
      ...(compare && compare !== primary
        ? [
            {
              id: compareName,
              kind: 'outline' as const,
              dashed: true,
              values: scoreValues(compare[lens]),
            },
          ]
        : []),
    ];
    const pulse = (moved ?? []).filter((x) => x.lens === lens).map((x) => x.dimension);
    const title = lens === 'rcsbe' ? 'RCSBE profile' : "Bloom's taxonomy profile";
    const chart = drawRadar(radarModel(lensAxes(lens), layers), { title, pulse });
    return h(
      'figure',
      { class: 'profile-card' },
      h('figcaption', { text: title }),
      chart as unknown as Node,
      h(
        'ul',
        { class: 'profile-lines' },
        ...scores.map((s) =>
          h('li', { text: axisLine(lens, s), class: pulse.includes(s.dimension) ? 'pulse' : '' }),
        ),
      ),
      layers.length > 1
        ? h('p', {
            class: 'profile-legend',
            text: `Filled: ${primaryName}. Dashed: ${compareName}.`,
          })
        : null,
    );
  }
}
