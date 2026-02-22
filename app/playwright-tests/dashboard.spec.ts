import { test } from '@playwright/test';
test('dashboard with Igor', async ({ page }) => {
  await page.goto('http://localhost:1420');
  await page.waitForTimeout(4000);
  // Try to navigate to robots view
  try {
    await page.click('text=Robots', { timeout: 2000 });
    await page.waitForTimeout(2000);
  } catch {}
  await page.screenshot({ path: '/tmp/dashboard_igor.png' });
});
