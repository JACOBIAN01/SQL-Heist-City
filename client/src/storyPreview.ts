import { DEFAULT_STORY_SETTINGS, frameFor, type StoryMessage } from '@heist/shared';
import { I18n } from './i18n/I18n';
import { sampleChallenge } from './testing/FakeChallengeApi';
import { BarkView, SceneView } from './ui/hud/SceneView';
import { StoryView } from './ui/hud/StoryView';
import { ProblemPane } from './ui/sql/ProblemPane';
import './ui/sql/sqlPanel.css';

// Development only: the story screens with the default words, for reviews and screenshots.
const i18n = new I18n('en');
const row = document.getElementById('row') as HTMLElement;
const [one, two, three, four, five] = DEFAULT_STORY_SETTINGS.chains;
if (!one || !two || !three || !four || !five) throw new Error('the default story has no chains');

const journal: StoryMessage = {
  t: 'story',
  pages: 2,
  chains: [
    {
      bank: one.bank,
      name: one.name,
      fixer: one.fixer,
      state: 'done',
      step: 3,
      total: 3,
      page: one.page,
    },
    {
      bank: two.bank,
      name: two.name,
      fixer: two.fixer,
      state: 'done',
      step: 3,
      total: 3,
      page: two.page,
    },
    {
      bank: three.bank,
      name: three.name,
      fixer: three.fixer,
      state: 'active',
      step: 1,
      total: 3,
      current: { title: three.steps[1]?.title ?? '', text: three.steps[1]?.text ?? '' },
    },
    { bank: four.bank, name: four.name, fixer: four.fixer, state: 'locked', step: 0, total: 3 },
    { bank: five.bank, name: five.name, fixer: five.fixer, state: 'locked', step: 0, total: 3 },
  ],
};
const story = new StoryView(i18n);
story.update(journal);
story.hidden = false;

const scenes = new SceneView(i18n);
const intro = DEFAULT_STORY_SETTINGS.scenes[three.intro];
if (intro) scenes.play({ t: 'scene', id: three.intro, title: intro.title, lines: intro.lines });

const bark = new BarkView();
bark.show('Inez', 'Group it, count it, compare it.', performance.now());

const question = document.createElement('div');
question.id = 'question';
const pane = new ProblemPane(question);
const frame = frameFor('vault:bank-3:lock-1', DEFAULT_STORY_SETTINGS.frames);
pane.show(sampleChallenge({ rewardKey: 'vault:bank-3:lock-1', ...(frame ? { frame } : {}) }));

row.append(story.panel, scenes.root, bark.root, question);
