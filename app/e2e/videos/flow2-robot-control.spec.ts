import { test } from '@playwright/test';
import { smoothGoto, smoothClick, scenePause } from '../helpers/videoHelpers';
import { mkdirSync } from 'fs';

mkdirSync('e2e/results/videos', { recursive: true });

test('Flow 2: Robot Command & Control', async ({ page }) => {
  // Scene 1: Start at robots list
  await smoothGoto(page, '/#/robots', 3000);

  // Scene 2: Click on H1 Robot detail
  await smoothClick(page, 'text=Atlas H1', 2000);
  await scenePause(page, 3000);

  // Scene 3: Scroll through telemetry
  await page.evaluate(() => window.scrollBy(0, 300));
  await scenePause(page, 2000);
  await page.evaluate(() => window.scrollBy(0, 300));
  await scenePause(page, 2000);

  // Scene 4: Back to dashboard
  await smoothGoto(page, '/#/dashboard', 3000);

  // Scene 5: Alerts
  await smoothGoto(page, '/#/alerts', 3000);

  // Final pause
  await scenePause(page, 2000);
});
