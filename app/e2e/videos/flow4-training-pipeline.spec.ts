import { test } from '@playwright/test';
import { smoothGoto, smoothClick, scenePause } from '../helpers/videoHelpers';
import { mkdirSync } from 'fs';

mkdirSync('e2e/results/videos', { recursive: true });

test('Flow 4: Training Pipeline — Dataset → Train → Deploy', async ({ page }) => {
  // Scene 1: Datasets Hub — browse imported datasets
  await smoothGoto(page, '/#/datasets', 4000);

  // Scene 2: Scroll through dataset cards
  await page.evaluate(() => window.scrollBy(0, 200));
  await scenePause(page, 2000);

  // Scene 3: Navigate to Training page
  await smoothGoto(page, '/#/training', 3000);

  // Scene 4: Show History tab with completed jobs + loss values
  await smoothClick(page, 'text=History', 2500);
  await scenePause(page, 3000);

  // Scene 5: Scroll through job cards
  await page.evaluate(() => window.scrollBy(0, 300));
  await scenePause(page, 2000);

  // Scene 6: Open "New Training Job" wizard
  await smoothClick(page, 'text=New Training Job', 2000);
  await scenePause(page, 2000);

  // Scene 7: Step 1 — Select dataset
  await smoothClick(page, 'text=svla_so101_pickplace', 1500);
  await smoothClick(page, 'text=Continue', 1500);

  // Scene 8: Step 2 — Select SmolVLA model
  await smoothClick(page, 'text=SmolVLA', 1500);
  await smoothClick(page, 'text=Continue', 1500);

  // Scene 9: Step 3 — Hyperparameters (Quick Train preset)
  await smoothClick(page, 'text=Quick Train', 1500);
  await scenePause(page, 2500);
  await page.evaluate(() => window.scrollBy(0, 200));
  await scenePause(page, 1500);
  await smoothClick(page, 'text=Continue', 1500);

  // Scene 10: Step 4 — Resources
  await scenePause(page, 2000);
  await smoothClick(page, 'text=Continue', 1500);

  // Scene 11: Step 5 — Review & Submit
  await scenePause(page, 3000);

  // Scene 12: Close wizard (don't actually submit in demo)
  await page.keyboard.press('Escape');
  await scenePause(page, 1000);

  // Scene 13: Models page — where trained adapters land
  await smoothGoto(page, '/#/models', 3000);

  // Scene 14: Deployments page
  await smoothGoto(page, '/#/deployments', 3000);

  // Final pause
  await scenePause(page, 2000);
});
