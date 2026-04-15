import { test } from '@playwright/test';
import { smoothGoto, scenePause } from '../helpers/videoHelpers';
import { mkdirSync } from 'fs';

mkdirSync('e2e/results/videos', { recursive: true });

/**
 * Flow 3 — Operate → Comply (the ops side of the loop)
 * Live dashboard, fleet map, alerts, compliance audit.
 * Target duration: ~11 seconds.
 */
test('Flow 3: Operate and Comply', async ({ page }) => {
  // Scene 1 — Fleet dashboard (Operate)
  await smoothGoto(page, '/#/dashboard', 1900);

  // Scene 2 — Fleet map (Scale)
  await smoothGoto(page, '/#/fleet', 1900);

  // Scene 3 — Alerts
  await smoothGoto(page, '/#/alerts', 1500);

  // Scene 4 — Compliance audit (Trust)
  await smoothGoto(page, '/#/compliance', 2000);

  // Final beat
  await scenePause(page, 900);
});
