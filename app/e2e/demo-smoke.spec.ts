/**
 * @file demo-smoke.spec.ts
 * @description Exercise public demo navigation and API response contracts so a
 *   sidebar destination cannot silently unmount the entire application.
 * @feature demo
 */
import { expect, test } from '@playwright/test';

// /tour and /processes are absent on purpose: they are stops on the Missions
// rail now (TASK-277), not sidebar rows, so the walk below reaches them.
const destinations = [
  '/fleet', '/control-center', '/agent', '/alerts', '/patrol',
  '/pipeline', '/data-collection', '/datasets', '/training',
  '/deployments', '/fleet-learning', '/marketplace', '/compliance', '/updates',
  '/docs', '/settings',
];

for (const destination of destinations) {
  test(`demo navigation to ${destination} keeps the application usable`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('./#/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

    // Use the actual sidebar link: full page reloads would hide the root-unmount
    // regression, because a reload creates a fresh React root.
    await page.locator(`aside a[href="#${destination}"]:visible`).click();
    await expect(page).toHaveURL(new RegExp(`#${destination}(?:/|$)`));
    await expect(page.locator('main').getByRole('heading').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
    await expect(page.locator('main').getByRole('heading').first()).toBeVisible();
    expect(errors).toEqual([]);

    if (destination === '/updates') {
      await expect(page.getByText('No update packages yet', { exact: true })).toBeVisible();
    }
    if (destination === '/pipeline') {
      // With no trained model, evaluation and deployment wait for upstream work.
      await expect(page.getByText('Complete previous step first')).toHaveCount(2);
      await expect(page.getByText('Could not load sim runs')).toHaveCount(0);
    }

    if (['/updates', '/pipeline'].includes(destination)) {
      await page.screenshot({ path: testInfo.outputPath(`${destination.slice(1)}.png`), fullPage: true });
    }

    await page.locator('aside a[href="#/dashboard"]:visible').click();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

// The sites gallery is Fleet's Sites tab now (TASK-276), so it is no longer a
// sidebar destination — it is reached the way a user reaches it, through the tab
// bar, and the twin viewer it opens is still a route of its own.
test("Fleet's Sites tab lists the scanned rooms", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./#/fleet');
  await expect(page.getByRole('heading', { name: 'Fleet', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Sites', exact: true }).click();
  await expect(page).toHaveURL(/#\/fleet\?tab=sites/);
  await expect(page.getByRole('button', { name: 'New scan', exact: true })).toBeEnabled();
  await expect(page.getByText('No sites yet', { exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('fleet-sites.png'), fullPage: true });
});

// Patrol, Guide and Automations are one Missions row now (TASK-277). Only
// /patrol is a sidebar destination; the other two are reached the way a user
// reaches them, through the rail the row owns — which is also the only place
// this regression could hide, since the routes themselves never changed.
test('the Missions rail reaches Guide and Automations, and holds on a route editor', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./#/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  await page.locator('aside a[href="#/patrol"]:visible').click();
  await expect(page.getByRole('heading', { name: 'Patrol', exact: true })).toBeVisible();

  const rail = page.getByRole('navigation', { name: 'Section' });
  await rail.getByRole('link', { name: 'Guide' }).click();
  await expect(page).toHaveURL(/#\/tour$/);
  await expect(page.getByRole('heading', { name: 'Guide', exact: true })).toBeVisible();
  await expect(rail.getByRole('link', { name: 'Guide' })).toHaveAttribute('aria-current', 'page');

  // The visit history is Guide's own second tab, one level under the rail —
  // the two levels coexist, which is why Missions is a rail and not tabs.
  await page.getByRole('tab', { name: /Visits/ }).click();
  await expect(page).toHaveURL(/#\/tour\?tab=visits$/);

  await rail.getByRole('link', { name: 'Automations' }).click();
  await expect(page).toHaveURL(/#\/processes$/);
  await expect(page.getByRole('heading', { name: 'Automations', exact: true })).toBeVisible();

  // A row owns everything under its paths, so the rail is still offered on the
  // editor: no dead end one level down.
  await rail.getByRole('link', { name: 'Patrol' }).click();
  // The header's own action — the empty state repeats the label under a
  // different testid.
  await page.getByTestId('patrol-new-route').click();
  await expect(page).toHaveURL(/#\/patrol\/routes\/new$/);
  await expect(rail.getByRole('link', { name: 'Patrol' })).toHaveAttribute('aria-current', 'page');

  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('missions-rail.png'), fullPage: true });
});

test('model registry renders and remains usable after loading models', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./#/models');
  await expect(page.getByRole('heading', { name: 'Model Registry', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  // The page header's primary action; an empty registry repeats it in the empty state.
  await expect(
    page.locator('header', { hasText: 'Model Registry' }).getByRole('button', { name: 'Register model', exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('models.png'), fullPage: true });
  await page.locator('aside a[href="#/dashboard"]:visible').click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
