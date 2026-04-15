import { test } from '@playwright/test';
import { smoothGoto, scenePause } from '../helpers/videoHelpers';
import { mkdirSync } from 'fs';

mkdirSync('e2e/results/videos', { recursive: true });

/**
 * Flow 2 — Collect → Train (the dev side of the loop)
 * Datasets, training studio, evaluation.
 * Target duration: ~9 seconds.
 */
test('Flow 2: Collect and Train', async ({ page }) => {
  // Scene 1 — Datasets (Collect & curate)
  await smoothGoto(page, '/#/datasets', 1800);

  // Scene 2 — Training studio (Train)
  await smoothGoto(page, '/#/training', 2000);

  // Scene 3 — Evaluation (Quality gate before deploy)
  await smoothGoto(page, '/#/training?tab=evaluation', 1800);

  // Final beat
  await scenePause(page, 900);
});
