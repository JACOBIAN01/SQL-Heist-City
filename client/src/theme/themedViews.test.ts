import { afterEach, describe, expect, it } from 'vitest';
import { I18n } from '../i18n/I18n';
import { PayoutView } from '../ui/hud/PayoutView';
import { SceneView } from '../ui/hud/SceneView';
import { StoryView } from '../ui/hud/StoryView';
import { formatMoney } from '../ui/hud/Hud';
import { theme } from './theme';

afterEach(() => theme.set('default'));

describe('country themes in the views (34.7)', () => {
  it('writes the HUD purse and the payout in the country’s money', () => {
    theme.set('india');
    expect(formatMoney(1_500_000)).toBe('₹15,00,000');
    const v = new PayoutView(new I18n('en'));
    v.show({
      t: 'payout',
      outcome: 'complete',
      bank: 'bank-3',
      total: 2_500_000,
      lines: [{ id: 'vault', amount: 2_500_000 }],
      mastery: 0,
    });
    expect(v.panel.textContent).toContain('₹25,00,000');
    expect(v.panel.textContent).not.toContain('$');
  });

  it('gives the story the country’s names for the cast and the banks', () => {
    theme.set('india');
    const story = new StoryView(new I18n('en'));
    story.update({
      t: 'story',
      pages: 0,
      chains: [
        {
          bank: 'bank-1',
          name: 'The first page',
          fixer: { name: 'Mae Okafor', role: 'former teller at Corner Savings' },
          state: 'active',
          step: 0,
          total: 3,
          current: { title: 'The briefing', text: 'Read the terminal outside Corner Savings.' },
        },
      ],
    });
    expect(story.panel.textContent).toContain('Meera Kapoor, former teller at Gram Sahakari Bank');
    expect(story.panel.textContent).toContain('outside Gram Sahakari Bank');
    expect(story.panel.textContent).not.toContain('Corner Savings');
  });

  it('plays scenes with the local cast, and leaves the default theme alone', () => {
    const scene = {
      t: 'scene' as const,
      id: 's',
      title: 'Corner Savings',
      lines: [{ speaker: 'Mae', text: 'Hello.' }],
    };
    const plain = new SceneView(new I18n('en'));
    plain.play(scene);
    expect(plain.root.textContent).toContain('Mae: Hello.');
    theme.set('uk');
    const uk = new SceneView(new I18n('en'));
    uk.play(scene);
    expect(uk.root.textContent).toContain('Maisie: Hello.');
    expect(uk.root.textContent).toContain('High Street Savings');
  });
});
