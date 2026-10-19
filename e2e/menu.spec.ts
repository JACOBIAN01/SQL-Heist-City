import { expect, test } from '@playwright/test';

test('sign in, change language in settings, and it stays', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Test player name').fill('Ana E2E');
  await page.getByRole('button', { name: 'Dev sign-in' }).click();

  // Development sign-ins are marked old enough; the age gate itself is covered by unit tests.
  await expect(page.getByText('Signed in as')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  const panel = page.locator('[data-role="settings"]');
  await expect(panel).toBeVisible();

  await panel.getByRole('tab', { name: 'Language' }).click();
  await panel.getByLabel('Language').selectOption('hi');
  await panel.getByRole('button', { name: 'बंद करें' }).click();
  await expect(page.getByRole('button', { name: 'साइन आउट' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'साइन आउट' })).toBeVisible();
});
