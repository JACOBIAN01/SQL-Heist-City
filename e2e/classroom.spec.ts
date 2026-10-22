import { expect, test, type APIRequestContext } from '@playwright/test';
import { CONSENT_STATEMENTS, CONSENT_VERSION } from '@heist/shared';
// The seeded admin from e2e/stack.mjs.
const E2E_ADMIN = { email: 'e2e-admin@school.test', password: 'e2e-only-not-a-real-secret' };

const ADMIN = 'http://localhost:8081/api';
const headers = { 'x-heist-admin': '1' };

/** A teacher (the seeded admin) makes a class, accepts the terms and releases some questions. */
async function setUpClass(request: APIRequestContext) {
  const login = await request.post(`${ADMIN}/auth/login`, { headers, data: E2E_ADMIN });
  expect(login.ok()).toBe(true);
  const created = await request.post(`${ADMIN}/classes`, { headers, data: { name: 'E2E 9B' } });
  const { class: record } = (await created.json()) as { class: { id: number; code: string } };
  // Students pick their own squads in this class (Phase 27.2).
  await request.put(`${ADMIN}/classes/${record.id}`, {
    headers,
    data: { squadMode: 'self', squadSize: 3 },
  });
  await request.post(`${ADMIN}/classes/${record.id}/consent`, {
    headers,
    data: { version: CONSENT_VERSION, accepted: CONSENT_STATEMENTS.map((s) => s.id) },
  });
  const { questions } = (await (await request.get(`${ADMIN}/questions`)).json()) as {
    questions: { id: number; tier: number }[];
  };
  const tier1 = questions.filter((q) => q.tier === 1).slice(0, 4);
  const usages = ['heal', 'vault', 'gun', 'ammo'] as const;
  const put = await request.put(`${ADMIN}/classes/${record.id}/questions`, {
    headers,
    data: { links: tier1.map((q, i) => ({ questionId: q.id, usage: usages[i] })) },
  });
  expect(put.ok()).toBe(true);
  return record;
}

test('a student joins with the code, waits, and is let in when the teacher starts the match', async ({
  page,
  request,
}) => {
  const klass = await setUpClass(request);

  await page.goto('/');
  await page.getByPlaceholder('Test player name').fill('Ben E2E');
  await page.getByRole('button', { name: 'Dev sign-in' }).click();
  await page.getByLabel('Class code').fill(klass.code);
  await page.getByRole('button', { name: 'Join class' }).click();

  // The waiting room: nothing starts until the teacher says so.
  await expect(page.getByText('Waiting for your teacher to start…')).toBeVisible();

  const started = await request.post(`${ADMIN}/classes/${klass.id}/live/start`, { headers });
  expect(started.ok()).toBe(true);

  // The page moves into the class's match.
  await expect(page).toHaveURL(new RegExp(`class=${klass.id}`));
  await expect(page.getByText(/^playing/)).toBeVisible();
  await expect(page.locator('body')).toContainText('BANKED');

  // The tasks the teacher released are the ones on offer.
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: /Vault lock/ }).or(page.getByText('Vault lock')),
  ).toBeVisible();

  // Progress: the skill tree (J) and the wardrobe (U) are there for a signed-in student, and the
  // free outfit can be worn while the earned ones are locked with what they need.
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyJ');
  const tree = page.locator('[data-role="skills"]');
  await expect(tree).toBeVisible();
  await expect(tree.locator('[data-skill="select"]')).toContainText('Open');
  await expect(tree.locator('[data-skill="joins"]')).toContainText('Locked');
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyU');
  const wardrobe = page.locator('[data-role="wardrobe"]');
  await expect(wardrobe).toBeVisible();
  await expect(wardrobe.locator('[data-cosmetic="outfit-gold"]')).toContainText(
    'Reach rank Safecracker',
  );
  await wardrobe.locator('[data-cosmetic="outfit-street"] button').click();
  await expect(wardrobe.locator('[data-cosmetic="outfit-street"] button')).toHaveText('Worn');
  await page.keyboard.press('Escape');

  // Squads (Phase 27): the student picks one and takes a role; the server checks both.
  await page.keyboard.press('KeyG');
  const squad = page.locator('[data-role="squad"]');
  await expect(squad).toBeVisible();
  await expect(squad).toContainText('You are not in a squad.');
  await squad.getByRole('button', { name: 'Join Red (0/3)' }).click();
  await expect(squad).toContainText('You are in the Red squad.');
  await squad.getByRole('button', { name: 'Take Hacker' }).click();
  await expect(squad.locator('.squad-members')).toContainText('Hacker');
  await page.keyboard.press('Escape');

  // The teacher ends the round; the student sees the round end.
  const ended = await request.post(`${ADMIN}/classes/${klass.id}/live/end-round`, { headers });
  expect(ended.ok()).toBe(true);
  await expect(page.locator('body')).toContainText(/round (over|ended)|final|winner/i);
  // The squad's score is in the round results.
  await expect(page.locator('.hud-results .hud-squads')).toContainText('Red (1)');
});
