import { test } from '@playwright/test';
import { smoothGoto, scenePause } from '../helpers/videoHelpers';
import { mkdirSync } from 'fs';

mkdirSync('e2e/results/videos', { recursive: true });

test('Flow 1: Platform Overview', async ({ page }) => {
  // Scene 1: Landing Page
  await smoothGoto(page, '/#/', 3000);

  // Scene 2: Dashboard — Fleet Overview
  await smoothGoto(page, '/#/dashboard', 4000);

  // Scene 3: Robot List
  await smoothGoto(page, '/#/robots', 3500);

  // Scene 4: Fleet Map
  await smoothGoto(page, '/#/fleet', 4000);

  // Scene 5: Alerts
  await smoothGoto(page, '/#/alerts', 3000);

  // Scene 6: Docs
  await smoothGoto(page, '/#/docs', 3000);

  // Final pause
  await scenePause(page, 2000);
});
