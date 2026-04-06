import { test } from '@playwright/test';
import { smoothGoto, smoothClick, scenePause, smoothScroll } from '../helpers/videoHelpers';
import { mkdirSync } from 'fs';

mkdirSync('e2e/results/videos', { recursive: true });

test('Flow 5: Data Collection — Record → Review → Train', async ({ page }) => {
  // Scene 1: Data Collection dashboard
  await smoothGoto(page, '/#/data-collection', 4000);
  await smoothScroll(page, 300, 2500);

  // Scene 2: New session
  await smoothClick(page, 'text=New Session');
  await scenePause(page, 3000);
  await smoothScroll(page, 200, 2000);

  // Scene 3: Pipeline view
  await smoothGoto(page, '/#/pipeline', 4000);
  await smoothScroll(page, 400, 3000);

  // Scene 4: Datasets
  await smoothGoto(page, '/#/datasets', 3000);

  // Scene 5: Evaluation
  await smoothGoto(page, '/#/evaluation', 3000);
  await smoothScroll(page, 200, 2500);

  await scenePause(page, 2000);
});
