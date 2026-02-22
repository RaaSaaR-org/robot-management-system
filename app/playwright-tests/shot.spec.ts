import { test } from '@playwright/test';
test('app screenshot', async ({ page }) => {
  await page.goto('http://localhost:1420');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/tmp/app_full.png' });
});
