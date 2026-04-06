import { test } from '@playwright/test';
import { smoothGoto, smoothClick, scenePause, smoothScroll } from '../helpers/videoHelpers';
import { mkdirSync } from 'fs';

mkdirSync('e2e/results/videos', { recursive: true });

test('Flow 6: Robot Teleoperation & 3D Viewer', async ({ page }) => {
  // Scene 1: Robots list
  await smoothGoto(page, '/#/robots', 3500);

  // Scene 2: Click first robot
  await smoothClick(page, 'a[href*="/robots/"]');
  await scenePause(page, 3000);

  // Scene 3: Scroll telemetry
  await smoothScroll(page, 300, 2500);

  // Scene 4: 3D tab
  await smoothClick(page, '[role="tab"]:has-text("3D")');
  await scenePause(page, 4000);

  // Scene 5: Joint state
  await smoothScroll(page, 400, 3000);

  // Scene 6: Teleop tab
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await smoothClick(page, '[role="tab"]:has-text("Teleop")');
  await scenePause(page, 3000);

  // Scene 7: Orchestrator
  await smoothGoto(page, '/#/orchestrator', 3000);

  await scenePause(page, 2000);
});
