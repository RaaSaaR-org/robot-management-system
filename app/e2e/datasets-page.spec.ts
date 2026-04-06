/**
 * @file datasets-page.spec.ts
 * @description Functional test: datasets page renders imported datasets with status + metadata
 */
import { test, expect } from '@playwright/test';

// baseURL comes from playwright.config.ts (demo mode uses HashRouter)

test.describe('Datasets page', () => {
  test('lists imported datasets with status badges and frame counts', async ({ page }) => {
    await page.goto(`/#/datasets`);
    await page.waitForSelector('text=Datasets', { timeout: 10_000 });

    // Stats bar should show totals
    await expect(page.locator('text=Total Datasets')).toBeVisible();
    await expect(page.locator('text=Ready')).toBeVisible();
    await expect(page.locator('text=Total Frames')).toBeVisible();

    // At least one dataset card should be visible with a Ready badge
    const readyBadge = page.locator('text=Ready').first();
    await expect(readyBadge).toBeVisible();

    // Frame count should be displayed on cards
    const framesLabel = page.locator('text=Frames').first();
    await expect(framesLabel).toBeVisible();

    // LeRobot version tag should appear
    const versionTag = page.locator('text=LeRobot v3.0').first();
    await expect(versionTag).toBeVisible({ timeout: 3_000 });
  });

  test('search filters datasets', async ({ page }) => {
    await page.goto(`/#/datasets`);
    await page.waitForSelector('text=Datasets', { timeout: 10_000 });

    // Type in search
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('svla');

    // Should still show svla datasets
    await expect(page.locator('text=svla_so101_pickplace').first()).toBeVisible({ timeout: 3_000 });
  });
});
