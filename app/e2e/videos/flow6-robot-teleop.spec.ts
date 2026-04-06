import { test } from '@playwright/test';
import { smoothGoto, smoothClick, scenePause } from '../helpers/videoHelpers';
import { mkdirSync } from 'fs';

mkdirSync('e2e/results/videos', { recursive: true });

test('Flow 6: Robot Teleoperation & 3D Viewer', async ({ page }) => {
  // Scene 1: Robots list
  await smoothGoto(page, '/#/robots', 3000);

  // Scene 2: Click into SO-101 robot detail
  await smoothClick(page, 'text=SO101', 2000);
  await scenePause(page, 3000);

  // Scene 3: Scroll through telemetry data
  await page.evaluate(() => window.scrollBy(0, 300));
  await scenePause(page, 2500);

  // Scene 4: Switch to 3D tab (joint visualization)
  await smoothClick(page, 'text=3D', 2000);
  await scenePause(page, 4000);

  // Scene 5: Scroll to see joint state grid
  await page.evaluate(() => window.scrollBy(0, 400));
  await scenePause(page, 3000);

  // Scene 6: Switch to Teleop tab
  await smoothClick(page, 'text=Teleop', 2000);
  await scenePause(page, 3000);

  // Scene 7: Back to robot overview
  await page.evaluate(() => window.scrollTo(0, 0));
  await scenePause(page, 2000);

  // Scene 8: Orchestrator — AI control
  await smoothGoto(page, '/#/orchestrator', 3000);

  // Final pause
  await scenePause(page, 2000);
});
