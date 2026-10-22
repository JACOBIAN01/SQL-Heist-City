import { expect, test, type Browser, type Page } from '@playwright/test';
import { CONSENT_STATEMENTS, CONSENT_VERSION } from '@heist/shared';

const ADMIN = 'http://localhost:8081/api';
const headers = { 'x-heist-admin': '1' };
const E2E_ADMIN = { email: 'e2e-admin@school.test', password: 'e2e-only-not-a-real-secret' };

async function student(browser: Browser, name: string, code: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  page.on(
    'console',
    (m) => m.type() === 'error' && console.log(`[${name}] console`, m.text().slice(0, 200)),
  );
  await page.goto('/');
  await page.getByPlaceholder('Test player name').fill(name);
  await page.getByRole('button', { name: 'Dev sign-in' }).click();
  await page.getByLabel('Class code').fill(code);
  await page.getByRole('button', { name: 'Join class' }).click();
  await expect(page.getByText('Waiting for your teacher to start…')).toBeVisible();
  return page;
}

test('SQL Quick Draw: two students face the same question and the first correct answer wins the point', async ({
  browser,
  request,
}, testInfo) => {
  testInfo.setTimeout(240_000); // two software-rendered game clients load slowly side by side
  // A class in the quick-draw mode, with one released question whose answer never changes.
  expect((await request.post(`${ADMIN}/auth/login`, { headers, data: E2E_ADMIN })).ok()).toBe(true);
  const { class: klass } = (await (
    await request.post(`${ADMIN}/classes`, {
      headers,
      data: { name: 'Duel 9B', mode: 'quick-draw' },
    })
  ).json()) as { class: { id: number; code: string; mode: string } };
  expect(klass.mode).toBe('quick-draw');
  await request.post(`${ADMIN}/classes/${klass.id}/consent`, {
    headers,
    data: { version: CONSENT_VERSION, accepted: CONSENT_STATEMENTS.map((s) => s.id) },
  });
  const { questions } = (await (await request.get(`${ADMIN}/questions`)).json()) as {
    questions: { id: number; slug: string }[];
  };
  const roster = questions.find((q) => q.slug === 't1-staff-roster');
  if (!roster) throw new Error('the staff roster question is missing');
  await request.put(`${ADMIN}/classes/${klass.id}/questions`, {
    headers,
    data: { links: [{ questionId: roster.id, usage: 'heal' }] },
  });

  const ana = await student(browser, 'Ana Duel', klass.code);
  const ben = await student(browser, 'Ben Duel', klass.code);
  expect((await request.post(`${ADMIN}/classes/${klass.id}/live/start`, { headers })).ok()).toBe(
    true,
  );

  // Both are paired and counted down, then the very same question opens for both.
  for (const [page, other] of [
    [ana, 'Ben Duel'],
    [ben, 'Ana Duel'],
  ] as const) {
    await expect(page.locator('[data-role="duel"]')).toContainText(other, {
      timeout: 90_000, // paired (the short countdown may already be over by now)
    });
  }
  const panel = (p: Page) => p.getByRole('dialog', { name: 'SQL challenge' });
  await expect(panel(ana)).toBeVisible({ timeout: 30_000 });
  await expect(panel(ben)).toBeVisible();
  await expect(ana.locator('[data-role="duel"]')).toContainText('Draw 1 of 5');
  await expect(panel(ana)).toContainText('Staff Roster');
  await expect(panel(ben)).toContainText('Staff Roster');

  // Ana answers first.
  await panel(ana).locator('.cm-content').click();
  await ana.keyboard.type('SELECT first_name, last_name FROM employees;');
  await panel(ana)
    .getByRole('button', { name: /Submit/ })
    .click();

  await expect(ana.locator('[data-role="duel"]')).toContainText('You were faster!');
  await expect(ben.locator('[data-role="duel"]')).toContainText('Ana Duel was faster.');
  // Ben's question is taken away: the draw is over.
  await expect(panel(ben)).toBeHidden();
  // The next draw opens by itself, with the score kept.
  await expect(ana.locator('[data-role="duel"]')).toContainText('Draw 2 of 5 · you 1 – 0', {
    timeout: 30_000,
  });
  await expect(panel(ben)).toBeVisible();
});
