import { test } from '@playwright/test';
import { smoothGoto, scenePause } from '../helpers/videoHelpers';
import { mkdirSync } from 'fs';

mkdirSync('e2e/results/videos', { recursive: true });

/**
 * Flow 1 — Full Lifecycle Tour
 * One continuous sweep across the six lifecycle phases:
 *   Collect → Train → Deploy → Evaluate → Operate → Comply
 * Target duration: ~14 seconds.
 */
test('Flow 1: Full Lifecycle Tour', async ({ page }) => {
  // Scene 1 — The pitch: landing page
  await smoothGoto(page, '/#/', 1400);

  // Scene 2 — Collect
  await smoothGoto(page, '/#/datasets', 1500);

  // Scene 3 — Train
  await smoothGoto(page, '/#/training', 1500);

  // Scene 4 — Deploy
  await smoothGoto(page, '/#/deployments', 1500);

  // Scene 5 — Operate (the dashboard is the living heart of the platform)
  await smoothGoto(page, '/#/dashboard', 1800);

  // Scene 6 — Comply
  await smoothGoto(page, '/#/compliance', 1800);

  // Final beat
  await scenePause(page, 900);
});
