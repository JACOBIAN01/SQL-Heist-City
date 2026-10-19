import { expect, test, type Page } from '@playwright/test';

/** The number under HEALTH in the HUD. */
const health = async (page: Page): Promise<number> => {
  const lines = (await page.locator('body').innerText()).split('\n');
  return Number(lines[lines.indexOf('HEALTH') + 1]);
};

test.describe('tutorial: the first things a new player does', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?tutorial');
    await expect(page.getByText('TUTORIAL · STEP 1 OF 7')).toBeVisible();
    await expect(page.getByText(/^playing/)).toBeVisible();
  });

  test('Tab opens the task list, and a solved heal task heals', async ({ page }) => {
    const before = await health(page);
    await page.keyboard.press('Tab');
    await page.getByText('Small heal').click();
    const panel = page.getByRole('dialog', { name: 'SQL challenge' });
    await expect(panel).toBeVisible();

    // The tutorial question is fixed and its answer is free.
    await panel.getByRole('button', { name: 'Show solution (free)' }).click();
    await expect(panel.locator('.cm-content')).toContainText(
      'SELECT first_name, last_name FROM employees',
    );
    await panel.getByRole('button', { name: /Submit/ }).click();

    await expect(page.getByText('Correct! Small heal unlocked.')).toBeVisible();
    await expect.poll(() => health(page)).toBeGreaterThan(before);
  });

  test('a wrong query is refused and the player keeps playing', async ({ page }) => {
    await page.keyboard.press('Tab');
    await page.getByText('Small heal').click();
    const panel = page.getByRole('dialog', { name: 'SQL challenge' });
    await panel.locator('.cm-content').click();
    await page.keyboard.type('SELECT 1;');
    await panel.getByRole('button', { name: /Submit/ }).click();
    await expect(page.getByText(/Correct!/)).toHaveCount(0);
    // The world never pauses: the connection is still live while the pop-up is open.
    await expect(page.getByText(/^playing/)).toBeVisible();
  });

  test('settings open in a match with the O key and can be closed with Esc', async ({ page }) => {
    await page.keyboard.press('KeyO');
    const panel = page.locator('[data-role="settings"]');
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });
});
