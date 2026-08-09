import { test } from '@playwright/test';
import { gotoDemo, screenshot, screenshotMobile } from '../helpers/demoReady';
import { mkdirSync } from 'fs';

mkdirSync('e2e/results/screenshots', { recursive: true });

/**
 * Screenshots captured in demo mode with MSW fixtures.
 * The landing page embeds exactly one of these — dashboard.png, in the Proof
 * section. It used to show three (dashboard, training, compliance) as a gallery;
 * that gallery is gone, so the rest are captured for docs and review only.
 */
test.describe('Demo Mode Screenshots', () => {
  test('landing page', async ({ page }) => {
    await gotoDemo(page, '/#/');
    await screenshot(page, 'landing');
    await screenshotMobile(page, 'landing');
  });

  test('dashboard', async ({ page }) => {
    await gotoDemo(page, '/#/dashboard');
    await page
      .waitForSelector('[data-testid="robot-card"], .robot-card, h2, [class*="card"]', {
        timeout: 5000,
      })
      .catch(() => {});
    await page.locator('.animate-spin').first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    await screenshot(page, 'dashboard');
    await screenshotMobile(page, 'dashboard');
  });

  test('robots list', async ({ page }) => {
    await gotoDemo(page, '/#/robots');
    await page.waitForSelector('table, [class*="robot"], [class*="list"]', { timeout: 5000 }).catch(() => {});
    await screenshot(page, 'robots');
    await screenshotMobile(page, 'robots');
  });

  test('H1 robot detail', async ({ page }) => {
    await gotoDemo(page, '/#/robots/demo-h1-001');
    await page.waitForSelector('[class*="telemetry"], [class*="detail"], main', { timeout: 5000 }).catch(() => {});
    await screenshot(page, 'robot-h1-detail');
    await screenshotMobile(page, 'robot-h1-detail');
  });

  test('fleet map', async ({ page }) => {
    await gotoDemo(page, '/#/fleet');
    await page.waitForSelector('canvas, [class*="map"], [class*="fleet"]', { timeout: 5000 }).catch(() => {});
    await page.locator('.animate-spin').first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    await screenshot(page, 'fleet-map');
    await screenshotMobile(page, 'fleet-map');
  });

  test('alerts', async ({ page }) => {
    await gotoDemo(page, '/#/alerts');
    await page.waitForSelector('[class*="alert"], table, main', { timeout: 5000 }).catch(() => {});
    await screenshot(page, 'alerts');
    await screenshotMobile(page, 'alerts');
  });

  test('docs viewer', async ({ page }) => {
    await gotoDemo(page, '/#/docs');
    await page.waitForSelector('[class*="docs"], article, main', { timeout: 5000 }).catch(() => {});
    await screenshot(page, 'docs');
    await screenshotMobile(page, 'docs');
  });

  test('training studio', async ({ page }) => {
    await gotoDemo(page, '/#/training');
    await page.waitForSelector('main', { timeout: 5000 }).catch(() => {});
    await page.locator('.animate-spin').first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    await screenshot(page, 'training');
    await screenshotMobile(page, 'training');
  });

  test('datasets', async ({ page }) => {
    await gotoDemo(page, '/#/datasets');
    await page.waitForSelector('main', { timeout: 5000 }).catch(() => {});
    await page.locator('.animate-spin').first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    await screenshot(page, 'datasets');
    await screenshotMobile(page, 'datasets');
  });

  test('compliance', async ({ page }) => {
    await gotoDemo(page, '/#/compliance');
    await page.waitForSelector('main', { timeout: 5000 }).catch(() => {});
    await page.locator('.animate-spin').first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    await screenshot(page, 'compliance');
    await screenshotMobile(page, 'compliance');
  });

  test('deployments', async ({ page }) => {
    await gotoDemo(page, '/#/deployments');
    await page.waitForSelector('main', { timeout: 5000 }).catch(() => {});
    await page.locator('.animate-spin').first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    await screenshot(page, 'deployments');
    await screenshotMobile(page, 'deployments');
  });
});
