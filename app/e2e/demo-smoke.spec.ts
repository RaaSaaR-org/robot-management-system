/**
 * @file demo-smoke.spec.ts
 * @description Exercise public demo navigation and API response contracts so a
 *   sidebar destination cannot silently unmount the entire application.
 * @feature demo
 */
import { expect, test } from '@playwright/test';

const destinations = [
  '/fleet', '/control-center', '/agent', '/sites', '/alerts', '/patrol', '/tour',
  '/processes', '/pipeline', '/data-collection', '/datasets', '/training',
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

    if (destination === '/sites') {
      await expect(page.getByText('No sites yet. Start a scan above.')).toBeVisible();
    }
    if (destination === '/updates') {
      await expect(page.getByText('No update packages yet', { exact: true })).toBeVisible();
    }
    if (destination === '/pipeline') {
      // With no trained model, evaluation and deployment wait for upstream work.
      await expect(page.getByText('Complete previous step first')).toHaveCount(2);
      await expect(page.getByText('Could not load sim runs')).toHaveCount(0);
    }

    if (['/sites', '/updates', '/pipeline'].includes(destination)) {
      await page.screenshot({ path: testInfo.outputPath(`${destination.slice(1)}.png`), fullPage: true });
    }

    await page.locator('aside a[href="#/dashboard"]:visible').click();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('model registry renders and remains usable after loading models', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./#/models');
  await expect(page.getByRole('heading', { name: 'Model Registry', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: 'Register model', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('models.png'), fullPage: true });
  await page.locator('aside a[href="#/dashboard"]:visible').click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
