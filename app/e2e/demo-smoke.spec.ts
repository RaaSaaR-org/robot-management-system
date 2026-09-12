/**
 * @file demo-smoke.spec.ts
 * @description Exercise public demo navigation and API response contracts so a
 *   sidebar destination cannot silently unmount the entire application.
 * @feature demo
 */
import { expect, test } from '@playwright/test';

// Every sidebar row except Dashboard, which the walk returns to each time. What
// is absent is absent because it is no longer a row: /tour and /processes are
// stops on the Missions rail (TASK-277), /data-collection, /datasets, /training,
// /models and /fleet-learning are stops on the Skill Training rail (TASK-278),
// and /updates, /docs and /settings left the sidebar for the chrome (TASK-279).
// The three tests after this walk reach all of them the way a user does — the
// walk shrank, the coverage did not.
const destinations = [
  '/fleet', '/control-center', '/agent', '/alerts', '/patrol',
  '/pipeline', '/deployments', '/marketplace', '/compliance',
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

    if (destination === '/pipeline') {
      // With no trained model, evaluation and deployment wait for upstream work.
      await expect(page.getByText('Complete previous step first')).toHaveCount(2);
      await expect(page.getByText('Could not load sim runs')).toHaveCount(0);
    }

    if (destination === '/pipeline') {
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
  // The page header's own action — scoped, because the empty state repeats the
  // label under it, exactly as the model registry repeats "Register model".
  await expect(
    page.locator('main header').getByRole('button', { name: 'New scan', exact: true }),
  ).toBeEnabled();
  await expect(page.getByText('No sites yet', { exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('fleet-sites.png'), fullPage: true });
});

// Updates, Docs and Settings are chrome now (TASK-279): the update packages are
// a Settings tab the user menu opens, and the docs are a help icon in the top
// bar. Neither has a sidebar link left, so this is the only path to them.
test('the top bar reaches Settings, its Updates tab and the docs', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./#/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Updates', exact: true }).click();
  await expect(page).toHaveURL(/#\/settings\?tab=updates$/);
  await expect(page.getByText('No update packages yet', { exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('settings-updates.png'), fullPage: true });

  // The old sidebar row still answers, one redirect later.
  await page.goto('./#/updates');
  await expect(page).toHaveURL(/#\/settings\?tab=updates$/);

  await page.getByRole('link', { name: 'Docs', exact: true }).click();
  await expect(page).toHaveURL(/#\/docs(?:\/|$)/);
  await expect(page.locator('main').getByRole('heading').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
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

// The five build stages are stops on the Skill Training rail now (TASK-278), so
// none of them is a sidebar destination any more. This walk is what the list
// above gave up: every stage still renders, and the rail still carries the walk
// one level down — reached the way a user reaches it.
test('the Skill Training rail reaches every build stage', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./#/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  await page.locator('aside a[href="#/pipeline"]:visible').click();
  await expect(page.getByRole('heading', { name: 'Pipeline', exact: true })).toBeVisible();

  const rail = page.getByRole('navigation', { name: 'Section' });
  const stages = [
    { label: 'Collect', path: '/data-collection' },
    { label: 'Datasets', path: '/datasets' },
    { label: 'Train', path: '/training' },
    { label: 'Models', path: '/models' },
    { label: 'Learning', path: '/fleet-learning' },
    { label: 'Overview', path: '/pipeline' },
  ];
  for (const stage of stages) {
    await rail.getByRole('link', { name: stage.label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${stage.path}(?:\\?|/|$)`));
    await expect(page.locator('main').getByRole('heading').first()).toBeVisible();
    // The rail survives the navigation it performed: no stage is a dead end.
    await expect(rail.getByRole('link', { name: stage.label, exact: true })).toHaveAttribute('aria-current', 'page');
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  }

  await page.screenshot({ path: testInfo.outputPath('skill-training-rail.png'), fullPage: true });
  await page.locator('aside a[href="#/dashboard"]:visible').click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
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
