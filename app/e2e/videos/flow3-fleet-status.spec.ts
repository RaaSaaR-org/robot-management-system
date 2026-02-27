import { test } from '@playwright/test';
import { smoothGoto, scenePause } from '../helpers/videoHelpers';
import { mkdirSync } from 'fs';

mkdirSync('e2e/results/videos', { recursive: true });

test('Flow 3: Fleet Status at a Glance', async ({ page }) => {
  // Scene 1: Dashboard with fleet overview
  await smoothGoto(page, '/#/dashboard', 5000);

  // Scene 2: Fleet Map
  await smoothGoto(page, '/#/fleet', 5000);

  // Scene 3: Back to dashboard
  await smoothGoto(page, '/#/dashboard', 4000);

  // Final pause
  await scenePause(page, 2000);
});
