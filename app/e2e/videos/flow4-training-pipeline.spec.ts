import { test } from '@playwright/test';
import { smoothGoto, smoothClick, scenePause, smoothScroll } from '../helpers/videoHelpers';
import { mkdirSync } from 'fs';

mkdirSync('e2e/results/videos', { recursive: true });

test('Flow 4: Training Pipeline — Dataset → Train → Deploy', async ({ page }) => {
  // Scene 1: Datasets Hub
  await smoothGoto(page, '/#/datasets', 4000);
  await smoothScroll(page, 200, 2000);

  // Scene 2: Training page
  await smoothGoto(page, '/#/training', 3500);

  // Scene 3: History tab
  await smoothClick(page, '[role="tab"]:has-text("History")');
  await scenePause(page, 2500);
  await smoothScroll(page, 300, 2000);

  // Scene 4: Open wizard
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await scenePause(page, 500);
  await smoothClick(page, 'button:has-text("New Training Job")');
  await scenePause(page, 2000);

  // Scene 5: Wizard — dataset
  await smoothClick(page, 'button:has-text("Ready")');
  await scenePause(page, 1000);
  await smoothClick(page, 'button:has-text("Continue"):not([disabled])');
  await scenePause(page, 1000);

  // Scene 6: Wizard — model
  await smoothClick(page, 'button:has-text("SmolVLA")');
  await scenePause(page, 1000);
  await smoothClick(page, 'button:has-text("Continue"):not([disabled])');
  await scenePause(page, 1000);

  // Scene 7: Wizard — hyperparams
  await smoothClick(page, 'button:has-text("Quick Train")');
  await scenePause(page, 1500);
  await smoothScroll(page, 200, 1500);
  await smoothClick(page, 'button:has-text("Continue"):not([disabled])');
  await scenePause(page, 1000);

  // Scene 8: Wizard — resources → review
  await smoothClick(page, 'button:has-text("Continue"):not([disabled])');
  await scenePause(page, 3000);

  // Close wizard
  await page.keyboard.press('Escape').catch(() => {});
  await scenePause(page, 1000);

  // Scene 9: Models + Deployments
  await smoothGoto(page, '/#/models', 3000);
  await smoothGoto(page, '/#/deployments', 3000);

  await scenePause(page, 2000);
});
