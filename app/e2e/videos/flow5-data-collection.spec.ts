import { test } from '@playwright/test';
import { smoothGoto, smoothClick, scenePause } from '../helpers/videoHelpers';
import { mkdirSync } from 'fs';

mkdirSync('e2e/results/videos', { recursive: true });

test('Flow 5: Data Collection — Record → Review → Train', async ({ page }) => {
  // Scene 1: Data Collection dashboard
  await smoothGoto(page, '/#/data-collection', 4000);

  // Scene 2: Scroll through session list
  await page.evaluate(() => window.scrollBy(0, 300));
  await scenePause(page, 2500);

  // Scene 3: Start a new session
  await smoothClick(page, 'text=New Session', 2000);
  await scenePause(page, 3000);

  // Scene 4: Explore session setup options
  await page.evaluate(() => window.scrollBy(0, 200));
  await scenePause(page, 2500);

  // Scene 5: Back to collection overview
  await page.goBack();
  await scenePause(page, 2000);

  // Scene 6: Pipeline view — see the full lifecycle
  await smoothGoto(page, '/#/pipeline', 4000);

  // Scene 7: Scroll through pipeline stages
  await page.evaluate(() => window.scrollBy(0, 400));
  await scenePause(page, 3000);

  // Scene 8: Jump to datasets (where collected data lands)
  await smoothGoto(page, '/#/datasets', 3000);

  // Scene 9: Evaluation — close the loop
  await smoothGoto(page, '/#/evaluation', 3000);

  // Final pause
  await scenePause(page, 2000);
});
