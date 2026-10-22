import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { SqlPanel } from './sql/SqlPanel';
import { MainMenu } from './menu/MainMenu';
import { Hud } from './hud/Hud';

// The page-level `region` rule is off: the HUD is an overlay on a canvas, not a document.
// jsdom has no layout, so colour contrast is checked by the palette tests (contrast ratios), not here.
const run = (el: Element) =>
  axe
    .run(el, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })
    .then((r) =>
      r.violations.map(
        (v) => `${v.id}: ${v.help} :: ${v.nodes.map((n) => n.html.slice(0, 160)).join(' | ')}`,
      ),
    );

afterEach(() => document.body.replaceChildren());

describe('structural accessibility (axe)', () => {
  it('the SQL pop-up open has no violations', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    const panel = new SqlPanel(host);
    panel.open();
    expect(await run(host)).toEqual([]);
  });

  it('the main menu signed in has no violations', async () => {
    const menu = new MainMenu({
      account: {
        me: async () => ({
          state: 'signed_in' as const,
          player: {
            id: 1,
            displayName: 'Ana',
            email: 'a@s.edu',
            schoolDomain: 's.edu',
            ageStatus: 'ok' as const,
          },
        }),
        ticket: async () => undefined,
        signOut: async () => {},
        rename: async () => ({ error: 'x' }),
        joinClass: async () => ({ error: 'x' }),
        exportData: async () => '',
        deleteAccount: async () => true,
        loadSettings: async () => undefined,
        loadProfile: async () => undefined,
        saveSettings: async () => {},
        declareAge: async () => ({ error: 'x' }),
        signInUrl: () => '',
        devSignInUrl: () => '',
      },
      go: () => {},
      navigate: () => {},
      returnTo: '',
      allowUnsigned: false,
      openSettings: () => {},
    });
    await menu.show();
    expect(await run(menu.root)).toEqual([]);
  });

  it('the HUD has no violations', async () => {
    new Hud(document.body);
    expect(await run(document.body)).toEqual([]);
  });
});
