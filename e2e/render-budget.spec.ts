import { expect, test, type Page } from '@playwright/test';

// Phase 23.4: draw calls and triangles are counted by the renderer, so they do not depend on the
// machine (unlike frame rate). A change that blows them up fails here. The numbers are the budget
// with room for normal growth; raise them on purpose, in the commit that adds the art.
const BUDGET = { tutorial: { calls: 200, kTris: 150 }, city: { calls: 700, kTris: 900 } };

async function drawn(page: Page) {
  await expect(page.getByText(/ calls · .*k tris/)).toBeVisible();
  // Let the streamed art (kit, banks) arrive, then read the overlay.
  await page.waitForTimeout(6000);
  const text = await page.getByText(/ calls · .*k tris/).innerText();
  const m = /(\d+) calls · ([\d.]+)k tris/.exec(text);
  if (!m) throw new Error(`no render numbers in: ${text}`);
  return { calls: Number(m[1]), kTris: Number(m[2]) };
}

test('the tutorial yard stays inside the draw budget', async ({ page }) => {
  await page.goto('/?tutorial');
  const n = await drawn(page);
  expect(n.calls).toBeLessThan(BUDGET.tutorial.calls);
  expect(n.kTris).toBeLessThan(BUDGET.tutorial.kTris);
});

test('the city at the spawn stays inside the draw budget', async ({ page }) => {
  await page.goto('/?play');
  const n = await drawn(page);
  expect(n.calls).toBeLessThan(BUDGET.city.calls);
  expect(n.kTris).toBeLessThan(BUDGET.city.kTris);
});
