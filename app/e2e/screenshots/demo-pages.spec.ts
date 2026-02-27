import { test } from '@playwright/test';
import { gotoDemo, screenshot, screenshotMobile } from '../helpers/demoReady';

// Ensure output directory exists
import { mkdirSync } from 'fs';
mkdirSync('e2e/results/screenshots', { recursive: true });

test.describe('Demo Mode Screenshots', () => {
  test('landing page', async ({ page }) => {
    await gotoDemo(page, '/#/');
    await screenshot(page, 'landing');
    await screenshotMobile(page, 'landing');
  });

  test('dashboard', async ({ page }) => {
    await gotoDemo(page, '/#/dashboard');
    // Wait for robots to load
    await page.waitForSelector('[data-testid="robot-card"], .robot-card, h2, [class*="card"]',
      { timeout: 5000 }).catch(() => {});
    await screenshot(page, 'dashboard');
    await screenshotMobile(page, 'dashboard');
  });

  test('robots list', async ({ page }) => {
    await gotoDemo(page, '/#/robots');
    await page.waitForSelector('table, [class*="robot"], [class*="list"]',
      { timeout: 5000 }).catch(() => {});
    await screenshot(page, 'robots');
    await screenshotMobile(page, 'robots');
  });

  test('H1 robot detail', async ({ page }) => {
    await gotoDemo(page, '/#/robots/demo-h1-001');
    await page.waitForSelector('[class*="telemetry"], [class*="detail"], main',
      { timeout: 5000 }).catch(() => {});
    await screenshot(page, 'robot-h1-detail');
    await screenshotMobile(page, 'robot-h1-detail');
  });

  test('fleet map', async ({ page }) => {
    await gotoDemo(page, '/#/fleet');
    await page.waitForSelector('canvas, [class*="map"], [class*="fleet"]',
      { timeout: 5000 }).catch(() => {});
    await screenshot(page, 'fleet-map');
    await screenshotMobile(page, 'fleet-map');
  });

  test('alerts', async ({ page }) => {
    await gotoDemo(page, '/#/alerts');
    await page.waitForSelector('[class*="alert"], table, main',
      { timeout: 5000 }).catch(() => {});
    await screenshot(page, 'alerts');
    await screenshotMobile(page, 'alerts');
  });

  test('docs viewer', async ({ page }) => {
    await gotoDemo(page, '/#/docs');
    await page.waitForSelector('[class*="docs"], article, main',
      { timeout: 5000 }).catch(() => {});
    await screenshot(page, 'docs');
    await screenshotMobile(page, 'docs');
  });
});
