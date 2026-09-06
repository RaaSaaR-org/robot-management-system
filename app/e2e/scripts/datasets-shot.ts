import { test } from '@playwright/test';
import { readFileSync } from 'fs';

test('datasets page screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  const token = readFileSync('/tmp/dev-token.txt', 'utf-8').trim();

  // Load app, inject token
  await page.goto('http://192.168.178.76:1420/#/');
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);

  await page.evaluate((t) => {
    localStorage.setItem('access_token', t);
    localStorage.setItem('refresh_token', t);
  }, token);

  // Navigate to datasets
  await page.goto('http://192.168.178.76:1420/#/datasets');
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(4000);

  await page.screenshot({ path: '/tmp/datasets-screenshot.png', fullPage: false });
});
